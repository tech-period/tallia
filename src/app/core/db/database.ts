import { DBSchema, IDBPDatabase, IDBPTransaction, openDB } from 'idb';
import { Case, Instance, Master, MasterImage, Project, ProjectImage } from './schema';

export const DB_NAME = 'tallia';
export const DB_VERSION = 3;

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
  'projects' | 'cases' | 'masters' | 'instances' | 'projectImages' | 'masterImages';

export const ALL_STORES: TalliaStoreName[] = [
  'projects',
  'cases',
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
    upgrade(db, oldVersion) {
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
