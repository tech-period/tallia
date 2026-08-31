import { Service, inject } from '@angular/core';
import { runTransaction } from '../db/database';
import {
  Label,
  MASTER_FILE_EXTENSION,
  MASTER_FILE_FORMAT,
  MASTER_FILE_VERSION,
  Master,
  MasterFile,
  MasterFileEntry,
  MasterFileImage,
  MasterImage,
  StoredImage,
  SUPPORTED_MASTER_FILE_VERSIONS,
} from '../db/schema';
import { CategoryRepository } from '../repositories/category.repository';
import { MasterImageRepository } from '../repositories/master-image.repository';
import { MasterRepository } from '../repositories/master.repository';
import { ProjectRepository } from '../repositories/project.repository';
import { TagRepository } from '../repositories/tag.repository';
import { downloadText, sanitizeForFileName, timestampForFileName } from '../../shared/utils/file';
import { newId, nowIso } from '../../shared/utils/id';
import { base64ToBytes, bytesToBase64 } from '../../shared/utils/image';
import { InvalidMasterFileError, NotFoundError } from './errors';
import { MasterImageService } from './master-image.service';

/** 取り込み先に同名のオブジェクトがあったときの扱い */
export type MasterImportMode = 'skip' | 'overwrite';

/** 取り込む前に見せる見積もり。実際の書き込みは行わない */
export interface MasterImportPreview {
  /** 新しく追加されるオブジェクト */
  added: number;
  /** 同名が既にあるオブジェクト（モードによって飛ばす / 上書きする） */
  existing: number;
  /** ファイルに含まれる画像 */
  images: number;
  /** 新しく作られるカテゴリ */
  newCategories: number;
  /** 新しく作られるタグ */
  newTags: number;
}

export interface MasterImportResult {
  added: number;
  updated: number;
  skipped: number;
  /** 実際に保存できた画像。壊れていた画像は含まない */
  images: number;
  /** 新しく作ったカテゴリ */
  categories: number;
  /** 新しく作ったタグ */
  tags: number;
}

/**
 * オブジェクトマスタをプロジェクト間で移し替える。
 *
 * バックアップ（`BackupService`）が「同じデータをそのまま復元する」のに対し、
 * こちらは「別のプロジェクトへ定義だけを持っていく」ためのもの。
 * ケースや記録（Instance）は移し替え先で意味を持たないので対象外にしている。
 *
 * ID を運ばない代わりに、突合はオブジェクト名で行う（`by-project-name` により
 * 名前はプロジェクト内で一意）。カテゴリ・タグも名前で解決し、無ければ作る。
 */
@Service()
export class MasterTransferService {
  private readonly projects = inject(ProjectRepository);
  private readonly masters = inject(MasterRepository);
  private readonly categories = inject(CategoryRepository);
  private readonly tags = inject(TagRepository);
  private readonly imageRecords = inject(MasterImageRepository);
  private readonly images = inject(MasterImageService);

  /** 指定プロジェクトのオブジェクトマスタを、カテゴリ・タグ・画像ごと書き出す */
  async exportProject(projectId: string): Promise<MasterFile> {
    const project = await this.projects.getById(projectId);
    if (!project) {
      throw new NotFoundError('プロジェクト', projectId);
    }
    const [masters, categories, tags, images] = await Promise.all([
      this.masters.getByProject(projectId),
      this.categories.getByProject(projectId),
      this.tags.getByProject(projectId),
      this.imageRecords.getByProject(projectId),
    ]);

    const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
    const tagNames = new Map(tags.map((tag) => [tag.id, tag.name]));
    const imagesByMaster = new Map(images.map((image) => [image.masterId, image]));

    return {
      format: MASTER_FILE_FORMAT,
      version: MASTER_FILE_VERSION,
      exportedAt: nowIso(),
      source: { projectName: project.name },
      categories: sortedNames(categories),
      tags: sortedNames(tags),
      // 差分を見比べやすいよう名前順で固定する
      masters: [...masters]
        .sort((a, b) => a.name.localeCompare(b.name, 'ja'))
        .map((master) => toEntry(master, categoryNames, tagNames, imagesByMaster.get(master.id))),
    };
  }

  /** `tallia-masters-{プロジェクト名}-{YYYYMMDD-HHmmss}.tallia` を組み立てる */
  fileName(projectName: string): string {
    const stamp = timestampForFileName(new Date());
    return `tallia-masters-${sanitizeForFileName(projectName)}-${stamp}${MASTER_FILE_EXTENSION}`;
  }

  download(file: MasterFile, fileName: string): void {
    downloadText(JSON.stringify(file, null, 2), fileName, 'application/json');
  }

  /**
   * ファイルの中身を検証して `MasterFile` にする。
   * 名前を持たない行と、ファイル内で名前が重複した 2 件目以降は落とす
   * （名前がプロジェクト内で一意という前提を、取り込み前にここで担保する）。
   */
  parse(text: string): MasterFile {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new InvalidMasterFileError(
        'ファイルを読み取れませんでした。Tallia から書き出したファイルを選んでください。',
      );
    }
    if (typeof raw !== 'object' || raw === null) {
      throw new InvalidMasterFileError('ファイルの中身が Tallia の形式ではありません。');
    }

    const candidate = raw as Partial<MasterFile>;
    if (candidate.format !== MASTER_FILE_FORMAT) {
      throw new InvalidMasterFileError(
        `このファイルはオブジェクトマスタの移し替え用ではありません（format: ${String(candidate.format)}）。`,
      );
    }
    if (
      typeof candidate.version !== 'number' ||
      !SUPPORTED_MASTER_FILE_VERSIONS.includes(candidate.version)
    ) {
      throw new InvalidMasterFileError(
        `対応していない形式です（version: ${String(candidate.version)}、対応: ${SUPPORTED_MASTER_FILE_VERSIONS.join(' / ')}）。`,
      );
    }
    if (!Array.isArray(candidate.masters)) {
      throw new InvalidMasterFileError('ファイルの構造が壊れています（masters）。');
    }

    const masters = normalizeEntries(candidate.masters);
    if (masters.length === 0) {
      throw new InvalidMasterFileError('取り込めるオブジェクトが 1 件もありませんでした。');
    }

    return {
      format: MASTER_FILE_FORMAT,
      version: candidate.version,
      exportedAt: typeof candidate.exportedAt === 'string' ? candidate.exportedAt : nowIso(),
      source: {
        projectName:
          typeof candidate.source?.projectName === 'string' ? candidate.source.projectName : '',
      },
      categories: normalizeNames(candidate.categories),
      tags: normalizeNames(candidate.tags),
      masters,
    };
  }

  /** 取り込み先の現状と突き合わせて、何が起きるかを数える */
  async preview(projectId: string, file: MasterFile): Promise<MasterImportPreview> {
    const [masters, categories, tags] = await Promise.all([
      this.masters.getByProject(projectId),
      this.categories.getByProject(projectId),
      this.tags.getByProject(projectId),
    ]);
    const masterNames = new Set(masters.map((master) => master.name));
    const categoryNames = new Set(categories.map((category) => category.name));
    const tagNames = new Set(tags.map((tag) => tag.name));

    // 宣言されている分類と、オブジェクトから参照されている分類の両方を数える
    const newCategories = new Set(file.categories.filter((name) => !categoryNames.has(name)));
    const newTags = new Set(file.tags.filter((name) => !tagNames.has(name)));
    let added = 0;
    let existing = 0;
    let images = 0;
    for (const entry of file.masters) {
      if (masterNames.has(entry.name)) {
        existing += 1;
      } else {
        added += 1;
      }
      if (entry.image) {
        images += 1;
      }
      if (entry.category && !categoryNames.has(entry.category)) {
        newCategories.add(entry.category);
      }
      for (const tag of entry.tags) {
        if (!tagNames.has(tag)) {
          newTags.add(tag);
        }
      }
    }

    return {
      added,
      existing,
      images,
      newCategories: newCategories.size,
      newTags: newTags.size,
    };
  }

  /**
   * ファイルの内容を `projectId` のプロジェクトへ取り込む。
   * 単一トランザクションで実行し、途中で失敗した場合はロールバックする。
   *
   * `skip` は同名のオブジェクトを飛ばし、`overwrite` はカテゴリ・タグ・メモ・画像を
   * ファイルの内容で置き換える（ファイルに画像が無ければ既存の画像も消す）。
   * どちらのモードでも、既存のオブジェクトが消えることはない。
   */
  async import(
    projectId: string,
    file: MasterFile,
    mode: MasterImportMode,
  ): Promise<MasterImportResult> {
    const project = await this.projects.getById(projectId);
    if (!project) {
      throw new NotFoundError('プロジェクト', projectId);
    }

    // トランザクションは待機している間に自動コミットされるため、
    // base64 のデコードは開始前に済ませておく
    const decoded = file.masters.map((entry) => (entry.image ? decodeImage(entry.image) : null));

    const result: MasterImportResult = {
      added: 0,
      updated: 0,
      skipped: 0,
      images: 0,
      categories: 0,
      tags: 0,
    };

    await runTransaction(async (tx) => {
      const [existingMasters, existingCategories, existingTags] = await Promise.all([
        this.masters.getByProject(projectId, tx),
        this.categories.getByProject(projectId, tx),
        this.tags.getByProject(projectId, tx),
      ]);

      const mastersByName = new Map(existingMasters.map((master) => [master.name, master]));
      const timestamp = nowIso();
      const categories = new LabelResolver(existingCategories, projectId, timestamp);
      const tags = new LabelResolver(existingTags, projectId, timestamp);
      const ensureCategory = async (name: string): Promise<string> => {
        const { id, created } = categories.resolve(name);
        if (created) {
          await this.categories.put(created, tx);
          result.categories += 1;
        }
        return id;
      };
      const ensureTag = async (name: string): Promise<string> => {
        const { id, created } = tags.resolve(name);
        if (created) {
          await this.tags.put(created, tx);
          result.tags += 1;
        }
        return id;
      };

      // 参照されていない分類も、ファイルの並び順のまま先に作っておく
      for (const name of file.categories) {
        await ensureCategory(name);
      }
      for (const name of file.tags) {
        await ensureTag(name);
      }

      for (const [index, entry] of file.masters.entries()) {
        const existing = mastersByName.get(entry.name);
        if (existing && mode === 'skip') {
          result.skipped += 1;
          continue;
        }

        const categoryId = entry.category ? await ensureCategory(entry.category) : undefined;
        const tagIds: string[] = [];
        for (const tag of entry.tags) {
          const id = await ensureTag(tag);
          if (!tagIds.includes(id)) {
            tagIds.push(id);
          }
        }

        const master: Master = existing
          ? { ...existing, tagIds, updatedAt: timestamp }
          : {
              id: newId(),
              projectId,
              name: entry.name,
              tagIds,
              createdAt: timestamp,
              updatedAt: timestamp,
            };
        if (categoryId) {
          master.categoryId = categoryId;
        } else {
          delete master.categoryId;
        }
        if (entry.note) {
          master.note = entry.note;
        } else {
          delete master.note;
        }
        await this.masters.put(master, tx);

        const image = decoded[index];
        if (image) {
          const record: MasterImage = { masterId: master.id, projectId, ...image };
          await this.imageRecords.put(record, tx);
          result.images += 1;
        } else if (existing) {
          // 上書きでは画像もファイルの内容に合わせる
          await this.imageRecords.deleteByMaster(master.id, tx);
        }

        if (existing) {
          result.updated += 1;
        } else {
          result.added += 1;
        }
      }
    });

    // 差し替わった画像の Object URL を握り続けないよう、いったん手放す。
    // 呼び出し側が画面を読み直した時点で作り直される
    this.images.forgetAll();

    return result;
  }
}

/**
 * 名前から分類マスタの ID を引き、無ければ作る。
 * `order` は取り込み先の末尾から連番で伸ばす。
 */
class LabelResolver {
  private readonly ids: Map<string, string>;
  private order: number;

  constructor(
    existing: readonly Label[],
    private readonly projectId: string,
    private readonly timestamp: string,
  ) {
    this.ids = new Map(existing.map((label) => [label.name, label.id]));
    this.order = existing.reduce((max, label) => Math.max(max, label.order), -1);
  }

  /** `created` が返ったときだけ、呼び出し側が保存する */
  resolve(name: string): { id: string; created: Label | null } {
    const known = this.ids.get(name);
    if (known) {
      return { id: known, created: null };
    }
    this.order += 1;
    const label: Label = {
      id: newId(),
      projectId: this.projectId,
      name,
      order: this.order,
      createdAt: this.timestamp,
      updatedAt: this.timestamp,
    };
    this.ids.set(name, label.id);
    return { id: label.id, created: label };
  }
}

/** `order` 順に並べた名前の配列 */
function sortedNames(labels: readonly Label[]): string[] {
  return [...labels].sort((a, b) => a.order - b.order).map((label) => label.name);
}

/** 保存済みのレコードを、ファイルに載せる 1 行にする */
function toEntry(
  master: Master,
  categoryNames: ReadonlyMap<string, string>,
  tagNames: ReadonlyMap<string, string>,
  image: MasterImage | undefined,
): MasterFileEntry {
  const entry: MasterFileEntry = {
    name: master.name,
    // 参照先が消えているタグは名前を出せないので落とす
    tags: master.tagIds
      .map((id) => tagNames.get(id))
      .filter((name): name is string => name !== undefined),
  };
  const category = master.categoryId ? categoryNames.get(master.categoryId) : undefined;
  if (category) {
    entry.category = category;
  }
  if (master.note) {
    entry.note = master.note;
  }
  if (image) {
    entry.image = {
      data: bytesToBase64(image.data),
      type: image.type,
      width: image.width,
      height: image.height,
    };
  }
  return entry;
}

/** 名前の配列を、空白除去 + 重複除去して整える */
function normalizeNames(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const names: string[] = [];
  for (const value of values) {
    const name = typeof value === 'string' ? value.trim() : '';
    if (name && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

/** ファイルの `masters` を検証して整える。名前が無い / 重複した行は落とす */
function normalizeEntries(values: readonly unknown[]): MasterFileEntry[] {
  const entries: MasterFileEntry[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'object' || value === null) {
      continue;
    }
    const raw = value as Partial<MasterFileEntry>;
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);

    const entry: MasterFileEntry = { name, tags: normalizeNames(raw.tags) };
    const category = typeof raw.category === 'string' ? raw.category.trim() : '';
    if (category) {
      entry.category = category;
    }
    const note = typeof raw.note === 'string' ? raw.note.trim() : '';
    if (note) {
      entry.note = note;
    }
    const image = normalizeImage(raw.image);
    if (image) {
      entry.image = image;
    }
    entries.push(entry);
  }
  return entries;
}

/** 画像の器だけを検証する。base64 が復元できるかは取り込み時に確かめる */
function normalizeImage(value: unknown): MasterFileImage | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const raw = value as Partial<MasterFileImage>;
  if (typeof raw.data !== 'string' || !raw.data) {
    return undefined;
  }
  return {
    data: raw.data,
    type: typeof raw.type === 'string' && raw.type ? raw.type : 'image/png',
    width: typeof raw.width === 'number' ? raw.width : 0,
    height: typeof raw.height === 'number' ? raw.height : 0,
  };
}

/**
 * base64 の画像を保存できる形に戻す。
 * 往復専用の形式なので、書き出し元で既に縮小・再圧縮済み。ここでは変換し直さない。
 * 壊れている 1 枚のために取り込み全体を失敗させない。
 */
function decodeImage(image: MasterFileImage): StoredImage | null {
  try {
    const data = base64ToBytes(image.data);
    return {
      data,
      type: image.type,
      width: image.width,
      height: image.height,
      size: data.byteLength,
      updatedAt: nowIso(),
    };
  } catch {
    return null;
  }
}
