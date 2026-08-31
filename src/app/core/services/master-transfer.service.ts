import { Service, inject } from '@angular/core';
import { runTransaction } from '../db/database';
import {
  Case,
  Label,
  MASTER_FILE_EXTENSION,
  MASTER_FILE_FORMAT,
  MASTER_FILE_VERSION,
  Master,
  MasterFile,
  MasterFileCase,
  MasterFileImage,
  MasterFileObject,
  MasterImage,
  StoredImage,
  SUPPORTED_MASTER_FILE_VERSIONS,
} from '../db/schema';
import { CaseRepository } from '../repositories/case.repository';
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

/** 取り込み先に同名のレコードがあったときの扱い */
export type MasterImportMode = 'skip' | 'overwrite';

/** マスタの種類ごとの内訳。画面ではこの並びで表に出す */
export interface MasterCounts {
  cases: number;
  categories: number;
  tags: number;
  masters: number;
}

/** 取り込む前に見せる見積もり。実際の書き込みは行わない */
export interface MasterImportPreview {
  /** 新しく追加されるもの */
  added: MasterCounts;
  /** 同名が既にあるもの（モードによって飛ばす / 上書きする） */
  existing: MasterCounts;
  /** ファイルに含まれる画像 */
  images: number;
}

export interface MasterImportResult {
  added: MasterCounts;
  /** 上書きしたもの。カテゴリ / タグは名前しか持たないため常に 0 */
  updated: MasterCounts;
  /** 同名のため手を触れなかったもの */
  skipped: MasterCounts;
  /** 実際に保存できた画像。壊れていた画像は含まない */
  images: number;
}

/**
 * マスタ 4 種（ケース / カテゴリ / タグ / オブジェクト）をプロジェクト間で移し替える。
 *
 * バックアップ（`BackupService`）が「同じデータをそのまま復元する」のに対し、
 * こちらは「別のプロジェクトへマスタの定義だけを配る」ためのもの。
 * 記録した個数（Instance）は移し替え先で意味を持たないので対象外にしている。
 *
 * ID を運ばない代わりに、突合は名前で行う（いずれのマスタも `by-project-name` により
 * 名前はプロジェクト内で一意）。オブジェクトとカテゴリ / タグの紐付けも名前で運び、
 * 取り込み時に移し替え先の ID へ解決し直す。
 */
@Service()
export class MasterTransferService {
  private readonly projects = inject(ProjectRepository);
  private readonly cases = inject(CaseRepository);
  private readonly categories = inject(CategoryRepository);
  private readonly tags = inject(TagRepository);
  private readonly masters = inject(MasterRepository);
  private readonly imageRecords = inject(MasterImageRepository);
  private readonly images = inject(MasterImageService);

  /** 指定プロジェクトのマスタを、オブジェクトのイメージ画像ごと書き出す */
  async exportProject(projectId: string): Promise<MasterFile> {
    const project = await this.projects.getById(projectId);
    if (!project) {
      throw new NotFoundError('プロジェクト', projectId);
    }
    const [cases, categories, tags, masters, images] = await Promise.all([
      this.cases.getByProject(projectId),
      this.categories.getByProject(projectId),
      this.tags.getByProject(projectId),
      this.masters.getByProject(projectId),
      this.imageRecords.getByProject(projectId),
    ]);
    const imagesByMaster = new Map(images.map((image) => [image.masterId, image]));
    // 紐付けは ID ではなく名前で運ぶ。参照先が消えているものは落とす
    const categoryNames = new Map(categories.map((label) => [label.id, label.name]));
    const tagNames = new Map(tags.map((label) => [label.id, label.name]));

    return {
      format: MASTER_FILE_FORMAT,
      version: MASTER_FILE_VERSION,
      exportedAt: nowIso(),
      source: { projectName: project.name },
      // ケース・カテゴリ・タグは表示順のまま並べる
      cases: byOrder(cases).map((target) => ({
        name: target.name,
        ...(target.note ? { note: target.note } : {}),
      })),
      categories: byOrder(categories).map((label) => label.name),
      tags: byOrder(tags).map((label) => label.name),
      // オブジェクトには表示順が無いので、差分を見比べやすい名前順で固定する
      masters: [...masters]
        .sort((a, b) => a.name.localeCompare(b.name, 'ja'))
        .map((master) =>
          toObjectEntry(master, imagesByMaster.get(master.id), categoryNames, tagNames),
        ),
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
   * 名前を持たない行と、同じ配列の中で名前が重複した 2 件目以降は落とす
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
        `このファイルはマスタの移し替え用ではありません（format: ${String(candidate.format)}）。`,
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

    const file: MasterFile = {
      format: MASTER_FILE_FORMAT,
      version: candidate.version,
      exportedAt: typeof candidate.exportedAt === 'string' ? candidate.exportedAt : nowIso(),
      source: {
        projectName:
          typeof candidate.source?.projectName === 'string' ? candidate.source.projectName : '',
      },
      cases: normalizeCases(candidate.cases),
      categories: normalizeNames(candidate.categories),
      tags: normalizeNames(candidate.tags),
      masters: normalizeObjects(candidate.masters),
    };
    // 分類の一覧に無い名前がオブジェクトから参照されていたら、一覧の側へ補う。
    // 「オブジェクトが参照する名前は必ず一覧にある」という前提を、ここで担保する
    appendMissingNames(
      file.categories,
      file.masters.map((master) => master.category),
    );
    appendMissingNames(
      file.tags,
      file.masters.flatMap((master) => master.tags ?? []),
    );
    if (total(countOf(file)) === 0) {
      throw new InvalidMasterFileError('取り込めるマスタが 1 件もありませんでした。');
    }
    return file;
  }

  /** 取り込み先の現状と突き合わせて、何が起きるかを数える */
  async preview(projectId: string, file: MasterFile): Promise<MasterImportPreview> {
    const [cases, categories, tags, masters] = await Promise.all([
      this.cases.getByProject(projectId),
      this.categories.getByProject(projectId),
      this.tags.getByProject(projectId),
      this.masters.getByProject(projectId),
    ]);

    const existing: MasterCounts = {
      cases: countExisting(
        file.cases.map((target) => target.name),
        cases,
      ),
      categories: countExisting(file.categories, categories),
      tags: countExisting(file.tags, tags),
      masters: countExisting(
        file.masters.map((master) => master.name),
        masters,
      ),
    };
    const inFile = countOf(file);

    return {
      added: {
        cases: inFile.cases - existing.cases,
        categories: inFile.categories - existing.categories,
        tags: inFile.tags - existing.tags,
        masters: inFile.masters - existing.masters,
      },
      existing,
      images: file.masters.filter((master) => master.image).length,
    };
  }

  /**
   * ファイルの内容を `projectId` のプロジェクトへ取り込む。
   * 単一トランザクションで実行し、途中で失敗した場合はロールバックする。
   *
   * 同名のレコードは `skip` なら手を触れず、`overwrite` ならメモと画像を
   * ファイルの内容で置き換える（ファイルに画像が無ければ既存の画像も消す）。
   * カテゴリ / タグは名前しか持たないため、同名があればどちらのモードでも何もしない。
   * どのモードでも、既存のレコードが削除されることはない。
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
    const decoded = file.masters.map((master) => (master.image ? decodeImage(master.image) : null));

    const result: MasterImportResult = {
      added: emptyCounts(),
      updated: emptyCounts(),
      skipped: emptyCounts(),
      images: 0,
    };

    await runTransaction(async (tx) => {
      const [existingCases, existingCategories, existingTags, existingMasters] = await Promise.all([
        this.cases.getByProject(projectId, tx),
        this.categories.getByProject(projectId, tx),
        this.tags.getByProject(projectId, tx),
        this.masters.getByProject(projectId, tx),
      ]);
      const timestamp = nowIso();

      // --- ケースマスタ ---
      const casesByName = new Map(existingCases.map((target) => [target.name, target]));
      let caseOrder = maxOrder(existingCases);
      for (const entry of file.cases) {
        const existing = casesByName.get(entry.name);
        if (!existing) {
          caseOrder += 1;
          const created: Case = {
            id: newId(),
            projectId,
            name: entry.name,
            ...(entry.note ? { note: entry.note } : {}),
            order: caseOrder,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          await this.cases.put(created, tx);
          result.added.cases += 1;
        } else if (mode === 'overwrite') {
          const updated: Case = { ...existing, updatedAt: timestamp };
          if (entry.note) {
            updated.note = entry.note;
          } else {
            delete updated.note;
          }
          await this.cases.put(updated, tx);
          result.updated.cases += 1;
        } else {
          result.skipped.cases += 1;
        }
      }

      // --- カテゴリマスタ / タグマスタ ---
      // 名前しか持たないため、同名があればモードに関わらず何もしない。
      // オブジェクトより先に片付けて、紐付けを解決するための名前 → ID を用意する
      const categoryIds = await this.putNewLabels(
        file.categories,
        existingCategories,
        (label) => this.categories.put(label, tx),
        projectId,
        timestamp,
      );
      result.added.categories = categoryIds.size - existingCategories.length;
      result.skipped.categories = file.categories.length - result.added.categories;
      const tagIds = await this.putNewLabels(
        file.tags,
        existingTags,
        (label) => this.tags.put(label, tx),
        projectId,
        timestamp,
      );
      result.added.tags = tagIds.size - existingTags.length;
      result.skipped.tags = file.tags.length - result.added.tags;

      // --- オブジェクトマスタ ---
      const mastersByName = new Map(existingMasters.map((master) => [master.name, master]));
      for (const [index, entry] of file.masters.entries()) {
        const existing = mastersByName.get(entry.name);
        if (existing && mode === 'skip') {
          result.skipped.masters += 1;
          continue;
        }

        const master: Master = existing
          ? { ...existing, updatedAt: timestamp }
          : {
              id: newId(),
              projectId,
              name: entry.name,
              tagIds: [],
              createdAt: timestamp,
              updatedAt: timestamp,
            };
        // 紐付けは移し替え先の ID に解決し直す。
        // 上書きのときはメモや画像と同じく、ファイルの内容で置き換える
        const categoryId = entry.category ? categoryIds.get(entry.category) : undefined;
        if (categoryId) {
          master.categoryId = categoryId;
        } else {
          delete master.categoryId;
        }
        master.tagIds = (entry.tags ?? [])
          .map((name) => tagIds.get(name))
          .filter((id): id is string => id !== undefined);
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
          result.updated.masters += 1;
        } else {
          result.added.masters += 1;
        }
      }
    });

    // 差し替わった画像の Object URL を握り続けないよう、いったん手放す。
    // 呼び出し側が画面を読み直した時点で作り直される
    this.images.forgetAll();

    return result;
  }

  /**
   * 取り込み先に無い名前だけを分類マスタへ追加し、名前 → ID の対応表を返す。
   * 対応表には取り込み先の既存分も入れる（オブジェクトの紐付けを解決するため）。
   * `order` は取り込み先の末尾から連番で伸ばす。
   */
  private async putNewLabels(
    names: readonly string[],
    existing: readonly Label[],
    put: (label: Label) => Promise<void>,
    projectId: string,
    timestamp: string,
  ): Promise<Map<string, string>> {
    const ids = new Map(existing.map((label) => [label.name, label.id]));
    let order = maxOrder(existing);
    for (const name of names) {
      if (ids.has(name)) {
        continue;
      }
      order += 1;
      const id = newId();
      await put({
        id,
        projectId,
        name,
        order,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      ids.set(name, id);
    }
    return ids;
  }
}

/** マスタの種類ごとの内訳をすべて 0 で作る */
export function emptyCounts(): MasterCounts {
  return { cases: 0, categories: 0, tags: 0, masters: 0 };
}

/** 内訳の合計 */
export function total(counts: MasterCounts): number {
  return counts.cases + counts.categories + counts.tags + counts.masters;
}

/** ファイルに入っている件数 */
function countOf(file: MasterFile): MasterCounts {
  return {
    cases: file.cases.length,
    categories: file.categories.length,
    tags: file.tags.length,
    masters: file.masters.length,
  };
}

/** 取り込み先に同名が既にあるものを数える */
function countExisting(names: readonly string[], existing: readonly { name: string }[]): number {
  const known = new Set(existing.map((record) => record.name));
  return names.filter((name) => known.has(name)).length;
}

/** `order` 昇順に並べ直す（元の配列は壊さない） */
function byOrder<T extends { order: number }>(records: readonly T[]): T[] {
  return [...records].sort((a, b) => a.order - b.order);
}

/** 取り込み先の末尾の `order`。1 件も無ければ -1 */
function maxOrder(records: readonly { order: number }[]): number {
  return records.reduce((max, record) => Math.max(max, record.order), -1);
}

/** 保存済みのオブジェクトを、ファイルに載せる 1 行にする */
function toObjectEntry(
  master: Master,
  image: MasterImage | undefined,
  categoryNames: ReadonlyMap<string, string>,
  tagNames: ReadonlyMap<string, string>,
): MasterFileObject {
  const entry: MasterFileObject = { name: master.name };
  const category = master.categoryId ? categoryNames.get(master.categoryId) : undefined;
  if (category) {
    entry.category = category;
  }
  const tags = master.tagIds
    .map((id) => tagNames.get(id))
    .filter((name): name is string => name !== undefined);
  if (tags.length > 0) {
    entry.tags = tags;
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

/** 分類の一覧に無い名前を、出てきた順に末尾へ足す（配列を直接書き換える） */
function appendMissingNames(names: string[], referenced: readonly (string | undefined)[]): void {
  const known = new Set(names);
  for (const name of referenced) {
    if (name && !known.has(name)) {
      names.push(name);
      known.add(name);
    }
  }
}

/**
 * 名前を持つレコードの配列を検証して整える。
 * 名前が無い行と、名前が重複した 2 件目以降は落とす。
 */
function normalizeRecords<T extends { name: string }>(
  values: unknown,
  build: (name: string, raw: Record<string, unknown>) => T,
): T[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const records: T[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'object' || value === null) {
      continue;
    }
    const raw = value as Record<string, unknown>;
    const name = typeof raw['name'] === 'string' ? raw['name'].trim() : '';
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    records.push(build(name, raw));
  }
  return records;
}

function normalizeCases(values: unknown): MasterFileCase[] {
  return normalizeRecords<MasterFileCase>(values, (name, raw) => {
    const entry: MasterFileCase = { name };
    const note = typeof raw['note'] === 'string' ? raw['note'].trim() : '';
    if (note) {
      entry.note = note;
    }
    return entry;
  });
}

function normalizeObjects(values: unknown): MasterFileObject[] {
  return normalizeRecords<MasterFileObject>(values, (name, raw) => {
    const entry: MasterFileObject = { name };
    // version 1 のファイルには紐付けが無いので、そのまま「未設定」になる
    const category = typeof raw['category'] === 'string' ? raw['category'].trim() : '';
    if (category) {
      entry.category = category;
    }
    const tags = normalizeNames(raw['tags']);
    if (tags.length > 0) {
      entry.tags = tags;
    }
    const note = typeof raw['note'] === 'string' ? raw['note'].trim() : '';
    if (note) {
      entry.note = note;
    }
    const image = normalizeImage(raw['image']);
    if (image) {
      entry.image = image;
    }
    return entry;
  });
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
