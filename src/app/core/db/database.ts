import { DBSchema, IDBPDatabase, IDBPTransaction, openDB } from 'idb';
import { newId, nowIso } from '../../shared/utils/id';
import {
  Category,
  Case,
  Instance,
  Master,
  MasterImage,
  Project,
  ProjectImage,
  Tag,
} from './schema';

export const DB_NAME = 'tallia';
export const DB_VERSION = 4;

export interface TalliaDB extends DBSchema {
  projects: {
    key: string;
    value: Project;
  };
  cases: {
    key: string;
    value: Case;
    indexes: {
      'by-project': string;
    };
  };
  categories: {
    key: string;
    value: Category;
    indexes: {
      'by-project': string;
      'by-project-name': [string, string];
    };
  };
  tags: {
    key: string;
    value: Tag;
    indexes: {
      'by-project': string;
      'by-project-name': [string, string];
    };
  };
  masters: {
    key: string;
    value: Master;
    indexes: {
      'by-project': string;
      'by-project-name': [string, string];
    };
  };
  instances: {
    key: string;
    value: Instance;
    indexes: {
      'by-project': string;
      'by-case': string;
      'by-master': string;
      'by-case-master': [string, string];
    };
  };
  projectImages: {
    key: string;
    value: ProjectImage;
  };
  masterImages: {
    key: string;
    value: MasterImage;
    indexes: {
      'by-project': string;
    };
  };
}

export type TalliaStoreName =
  | 'projects'
  | 'cases'
  | 'categories'
  | 'tags'
  | 'masters'
  | 'instances'
  | 'projectImages'
  | 'masterImages';

export const ALL_STORES: TalliaStoreName[] = [
  'projects',
  'cases',
  'categories',
  'tags',
  'masters',
  'instances',
  'projectImages',
  'masterImages',
];

/**
 * 全ストアを対象にした読み書きトランザクション。
 * トランザクション境界は Service 層が `runTransaction()` で作り、Repository へ渡す。
 */
export type TalliaTransaction = IDBPTransaction<TalliaDB, TalliaStoreName[], 'readwrite'>;

/** 実行環境が IndexedDB を利用できるか */
export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

let dbPromise: Promise<IDBPDatabase<TalliaDB>> | null = null;

/**
 * DB へのハンドルを返す。
 * インデックスの追加にはバージョンを上げる必要があるため、各バージョンで
 * 想定するインデックスをまとめて作る。`upgrade` は既存 DB からの移行も通るので、
 * `oldVersion` で段階的に適用する。
 */
export function getDb(): Promise<IDBPDatabase<TalliaDB>> {
  if (!isIndexedDbAvailable()) {
    return Promise.reject(
      new Error(
        'このブラウザでは IndexedDB を利用できません。プライベートブラウジングを解除するか、別のブラウザでお試しください。',
      ),
    );
  }

  dbPromise ??= openDB<TalliaDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        db.createObjectStore('projects', { keyPath: 'id' });

        const cases = db.createObjectStore('cases', { keyPath: 'id' });
        cases.createIndex('by-project', 'projectId');

        const masters = db.createObjectStore('masters', { keyPath: 'id' });
        masters.createIndex('by-project', 'projectId');
        masters.createIndex('by-project-name', ['projectId', 'name']);

        const instances = db.createObjectStore('instances', { keyPath: 'id' });
        instances.createIndex('by-project', 'projectId');
        instances.createIndex('by-case', 'caseId');
        instances.createIndex('by-master', 'masterId');
        // 数量型の一意性（1 ケース + 1 マスター = 1 レコード）をストア側で担保する
        instances.createIndex('by-case-master', ['caseId', 'masterId'], { unique: true });
      }

      if (oldVersion < 2) {
        // 一覧表示で毎回画像を読み込まずに済むよう、画像はプロジェクトと別ストアに置く
        db.createObjectStore('projectImages', { keyPath: 'projectId' });
      }

      if (oldVersion < 3) {
        const masterImages = db.createObjectStore('masterImages', { keyPath: 'masterId' });
        // 表示中プロジェクト分だけを読む / プロジェクト削除でまとめて消すために使う
        masterImages.createIndex('by-project', 'projectId');
      }

      if (oldVersion < 4) {
        // カテゴリとタグをマスタ化する。Master からは ID で参照する
        for (const name of ['categories', 'tags'] as const) {
          const store = db.createObjectStore(name, { keyPath: 'id' });
          store.createIndex('by-project', 'projectId');
          store.createIndex('by-project-name', ['projectId', 'name']);
        }
        if (oldVersion > 0) {
          // 既存の文字列をレコードへ振り替える。
          // versionchange トランザクションの中で完結するため await しない
          void migrateLabels(tx);
        }
      }
    },
    blocking() {
      // 別タブがバージョンを上げようとしている。接続を握り続けると相手が進めないため手放す
      void closeDb();
    },
    terminated() {
      dbPromise = null;
    },
  });

  return dbPromise;
}

/**
 * 全ストアを含む単一トランザクションで `fn` を実行する。
 * カスケード削除やインポートのように複数ストアの整合性が必要な操作で使う。
 */
export async function runTransaction<T>(fn: (tx: TalliaTransaction) => Promise<T>): Promise<T> {
  const db = await getDb();
  const tx = db.transaction(ALL_STORES, 'readwrite') as TalliaTransaction;
  try {
    const result = await fn(tx);
    await tx.done;
    return result;
  } catch (error) {
    // 既にコミット済みの場合 abort() は例外を投げるため握る。
    try {
      tx.abort();
    } catch {
      // no-op
    }
    // abort 由来の reject は無視し、元のエラーを投げ直す。
    await tx.done.catch(() => undefined);
    throw error;
  }
}

/** DB バージョン 3 以前の Master。カテゴリとタグを文字列で持っていた */
interface LegacyMaster extends Omit<Master, 'categoryId' | 'tagIds'> {
  category?: string;
  tags?: string[];
}

/**
 * 旧 Master が持っていたカテゴリ / タグの文字列を `categories` / `tags` の
 * レコードに起こし、Master 側は ID 参照へ書き換える。
 * 同じ名前はプロジェクトごとに 1 レコードへまとめる。
 */
async function migrateLabels(
  tx: IDBPTransaction<TalliaDB, TalliaStoreName[], 'versionchange'>,
): Promise<void> {
  const masterStore = tx.objectStore('masters');
  const legacyMasters = (await masterStore.getAll()) as unknown as LegacyMaster[];
  if (legacyMasters.length === 0) {
    return;
  }

  const timestamp = nowIso();
  const orders = new Map<string, number>();
  const ids = new Map<string, string>();

  /** `projectId` + 名前ごとに 1 件だけ作り、その ID を返す */
  const labelId = async (
    storeName: 'categories' | 'tags',
    projectId: string,
    name: string,
  ): Promise<string> => {
    const key = `${storeName}\u0000${projectId}\u0000${name}`;
    const known = ids.get(key);
    if (known) {
      return known;
    }
    const orderKey = `${storeName}\u0000${projectId}`;
    const order = orders.get(orderKey) ?? 0;
    orders.set(orderKey, order + 1);
    const label: Category | Tag = {
      id: newId(),
      projectId,
      name,
      order,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await tx.objectStore(storeName).put(label);
    ids.set(key, label.id);
    return label.id;
  };

  for (const legacy of legacyMasters) {
    const { category, tags, ...rest } = legacy;
    const migrated: Master = { ...rest, tagIds: [] };
    const categoryName = category?.trim();
    if (categoryName) {
      migrated.categoryId = await labelId('categories', legacy.projectId, categoryName);
    }
    for (const tag of tags ?? []) {
      const name = tag.trim();
      if (name) {
        const id = await labelId('tags', legacy.projectId, name);
        if (!migrated.tagIds.includes(id)) {
          migrated.tagIds.push(id);
        }
      }
    }
    await masterStore.put(migrated);
  }
}

/** 接続を閉じてキャッシュを破棄する（主にテスト用） */
export async function closeDb(): Promise<void> {
  if (!dbPromise) {
    return;
  }
  const pending = dbPromise;
  dbPromise = null;
  const db = await pending.catch(() => null);
  db?.close();
}
