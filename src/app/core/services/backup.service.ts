import { Service, inject } from '@angular/core';
import { runTransaction } from '../db/database';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  BackupFile,
  BackupImage,
  BackupMasterImage,
  BackupProjectImage,
  Case,
  Category,
  Instance,
  Label,
  Master,
  MasterImage,
  Project,
  ProjectImage,
  StoredImage,
  SUPPORTED_BACKUP_VERSIONS,
  Tag,
} from '../db/schema';
import { CaseRepository } from '../repositories/case.repository';
import { CategoryRepository } from '../repositories/category.repository';
import { InstanceRepository } from '../repositories/instance.repository';
import { MasterImageRepository } from '../repositories/master-image.repository';
import { MasterRepository } from '../repositories/master.repository';
import { ProjectImageRepository } from '../repositories/project-image.repository';
import { ProjectRepository } from '../repositories/project.repository';
import { TagRepository } from '../repositories/tag.repository';
import { downloadText, sanitizeForFileName, timestampForFileName } from '../../shared/utils/file';
import { newId, nowIso } from '../../shared/utils/id';
import { base64ToBytes, bytesToBase64 } from '../../shared/utils/image';
import { InvalidBackupError, NotFoundError } from './errors';
import { MasterImageService } from './master-image.service';
import { ProjectImageService } from './project-image.service';

/** インポートの取り込み方 */
export type ImportMode = 'append' | 'replace';

export interface ImportResult {
  projects: number;
  cases: number;
  categories: number;
  tags: number;
  masters: number;
  instances: number;
  /** プロジェクトの画像 */
  images: number;
  /** オブジェクトの画像 */
  masterImages: number;
}

@Service()
export class BackupService {
  private readonly projects = inject(ProjectRepository);
  private readonly cases = inject(CaseRepository);
  private readonly categories = inject(CategoryRepository);
  private readonly tags = inject(TagRepository);
  private readonly masters = inject(MasterRepository);
  private readonly instances = inject(InstanceRepository);
  private readonly imageRecords = inject(ProjectImageRepository);
  private readonly images = inject(ProjectImageService);
  private readonly masterImageRecords = inject(MasterImageRepository);
  private readonly masterImages = inject(MasterImageService);

  /** 全プロジェクトを 1 ファイルに書き出す */
  async exportAll(): Promise<BackupFile> {
    const [projects, cases, categories, tags, masters, instances, images, masterImages] =
      await Promise.all([
        this.projects.getAll(),
        this.allCases(),
        this.categories.getAll(),
        this.tags.getAll(),
        this.allMasters(),
        this.allInstances(),
        this.imageRecords.getAll(),
        this.masterImageRecords.getAll(),
      ]);
    return this.toBackup({
      projects,
      cases,
      categories,
      tags,
      masters,
      instances,
      images,
      masterImages,
    });
  }

  /** 指定プロジェクトに属するレコードだけを書き出す */
  async exportProject(projectId: string): Promise<BackupFile> {
    const project = await this.projects.getById(projectId);
    if (!project) {
      throw new NotFoundError('プロジェクト', projectId);
    }
    const [cases, categories, tags, masters, instances, image, masterImages] = await Promise.all([
      this.cases.getByProject(projectId),
      this.categories.getByProject(projectId),
      this.tags.getByProject(projectId),
      this.masters.getByProject(projectId),
      this.instances.getByProject(projectId),
      this.imageRecords.getByProject(projectId),
      this.masterImageRecords.getByProject(projectId),
    ]);
    return this.toBackup({
      projects: [project],
      cases,
      categories,
      tags,
      masters,
      instances,
      images: image ? [image] : [],
      masterImages,
    });
  }

  /** `tallia-{YYYYMMDD-HHmmss}.json` 形式のファイル名を組み立てる */
  fileName(projectName?: string): string {
    const stamp = timestampForFileName(new Date());
    if (projectName) {
      return `tallia-${sanitizeForFileName(projectName)}-${stamp}.json`;
    }
    return `tallia-${stamp}.json`;
  }

  /** Blob を作りダウンロードさせる */
  download(backup: BackupFile, fileName: string): void {
    downloadText(JSON.stringify(backup, null, 2), fileName, 'application/json');
  }

  /** JSON 文字列を検証して `BackupFile` にする */
  parse(text: string): BackupFile {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new InvalidBackupError('ファイルを JSON として読み取れませんでした。');
    }
    if (typeof raw !== 'object' || raw === null) {
      throw new InvalidBackupError('ファイルの中身が Tallia のバックアップ形式ではありません。');
    }

    const candidate = raw as Partial<BackupFile>;
    if (candidate.format !== BACKUP_FORMAT) {
      throw new InvalidBackupError(
        `このファイルは Tallia のバックアップではありません（format: ${String(candidate.format)}）。`,
      );
    }
    if (
      typeof candidate.version !== 'number' ||
      !SUPPORTED_BACKUP_VERSIONS.includes(candidate.version)
    ) {
      throw new InvalidBackupError(
        `対応していないバックアップ形式です（version: ${String(candidate.version)}、対応: ${SUPPORTED_BACKUP_VERSIONS.join(' / ')}）。`,
      );
    }
    if (
      !Array.isArray(candidate.projects) ||
      !Array.isArray(candidate.cases) ||
      !Array.isArray(candidate.masters) ||
      !Array.isArray(candidate.instances)
    ) {
      throw new InvalidBackupError(
        'バックアップの構造が壊れています（projects / cases / masters / instances)。',
      );
    }
    // 画像は version 1 には存在しないため、無い場合だけ許容する
    if (candidate.images !== undefined && !Array.isArray(candidate.images)) {
      throw new InvalidBackupError('バックアップの構造が壊れています（images）。');
    }
    // カテゴリ / タグは version 3 以前には存在しない
    if (candidate.categories !== undefined && !Array.isArray(candidate.categories)) {
      throw new InvalidBackupError('バックアップの構造が壊れています（categories）。');
    }
    if (candidate.tags !== undefined && !Array.isArray(candidate.tags)) {
      throw new InvalidBackupError('バックアップの構造が壊れています（tags）。');
    }

    return {
      format: BACKUP_FORMAT,
      version: candidate.version,
      exportedAt: candidate.exportedAt ?? nowIso(),
      projects: candidate.projects,
      cases: candidate.cases,
      categories: candidate.categories ?? [],
      tags: candidate.tags ?? [],
      masters: candidate.masters,
      instances: candidate.instances,
      images: candidate.images ?? [],
      masterImages: candidate.masterImages ?? [],
    };
  }

  /**
   * バックアップを取り込む。単一トランザクションで実行し、失敗時はロールバックする。
   * `append` は全 ID を採番し直して別プロジェクトとして追加、
   * `replace` は既存の全データを削除してから投入する。
   */
  async import(backup: BackupFile, mode: ImportMode): Promise<ImportResult> {
    // 旧版のファイルはカテゴリ / タグが文字列なので、先にレコードへ振り替える
    const migrated = migrateLegacyLabels(backup);
    const payload = mode === 'append' ? remapIds(migrated) : migrated;
    // トランザクションは待機している間に自動コミットされるため、
    // base64 のデコードは開始前に済ませておく
    const images = decodeProjectImages(payload.images ?? []);
    const masterImages = decodeMasterImages(payload.masterImages ?? []);

    await runTransaction(async (tx) => {
      if (mode === 'replace') {
        await this.projects.clear(tx);
        await this.cases.clear(tx);
        await this.categories.clear(tx);
        await this.tags.clear(tx);
        await this.masters.clear(tx);
        await this.instances.clear(tx);
        await this.imageRecords.clear(tx);
        await this.masterImageRecords.clear(tx);
      }
      for (const project of payload.projects) {
        await this.projects.put(project, tx);
      }
      for (const c of payload.cases) {
        await this.cases.put(c, tx);
      }
      for (const category of payload.categories ?? []) {
        await this.categories.put(category, tx);
      }
      for (const tag of payload.tags ?? []) {
        await this.tags.put(tag, tx);
      }
      for (const master of payload.masters) {
        await this.masters.put(master, tx);
      }
      for (const instance of payload.instances) {
        await this.instances.put(instance, tx);
      }
      for (const image of images) {
        await this.imageRecords.put(image, tx);
      }
      for (const image of masterImages) {
        await this.masterImageRecords.put(image, tx);
      }
    });

    if (mode === 'replace') {
      this.images.forgetAll();
    }
    this.masterImages.forgetAll();

    return {
      projects: payload.projects.length,
      cases: payload.cases.length,
      categories: payload.categories?.length ?? 0,
      tags: payload.tags?.length ?? 0,
      masters: payload.masters.length,
      instances: payload.instances.length,
      images: images.length,
      masterImages: masterImages.length,
    };
  }

  /** 全データを削除する */
  async deleteEverything(): Promise<void> {
    await runTransaction(async (tx) => {
      await this.instances.clear(tx);
      await this.cases.clear(tx);
      await this.categories.clear(tx);
      await this.tags.clear(tx);
      await this.masters.clear(tx);
      await this.imageRecords.clear(tx);
      await this.masterImageRecords.clear(tx);
      await this.projects.clear(tx);
    });
    this.images.forgetAll();
    this.masterImages.forgetAll();
  }

  private toBackup(source: {
    projects: Project[];
    cases: Case[];
    categories: Category[];
    tags: Tag[];
    masters: Master[];
    instances: Instance[];
    images: ProjectImage[];
    masterImages: MasterImage[];
  }): BackupFile {
    const { projects, cases, categories, tags, masters, instances, images, masterImages } = source;
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: nowIso(),
      projects,
      cases,
      categories,
      tags,
      masters,
      instances,
      images: images.map((image) => ({ projectId: image.projectId, ...encodeImage(image) })),
      masterImages: masterImages.map((image) => ({
        masterId: image.masterId,
        projectId: image.projectId,
        ...encodeImage(image),
      })),
    };
  }

  private async allCases(): Promise<Case[]> {
    const projects = await this.projects.getAll();
    const groups = await Promise.all(projects.map((p) => this.cases.getByProject(p.id)));
    return groups.flat();
  }

  private async allMasters(): Promise<Master[]> {
    const projects = await this.projects.getAll();
    const groups = await Promise.all(projects.map((p) => this.masters.getByProject(p.id)));
    return groups.flat();
  }

  private async allInstances(): Promise<Instance[]> {
    const projects = await this.projects.getAll();
    const groups = await Promise.all(projects.map((p) => this.instances.getByProject(p.id)));
    return groups.flat();
  }
}

/**
 * version 3 以前のバックアップは、カテゴリ / タグを Master に文字列で持っている。
 * プロジェクトごとに同じ名前を 1 レコードへまとめ、Master 側は ID 参照へ書き換える。
 * version 4 以降のファイルは既にレコードを持つため、そのまま通る。
 */
function migrateLegacyLabels(backup: BackupFile): BackupFile {
  const categories: Category[] = [...(backup.categories ?? [])];
  const tags: Tag[] = [...(backup.tags ?? [])];
  const timestamp = nowIso();
  const known = new Map<string, string>();

  /** `projectId` + 名前ごとに 1 件だけ作り、その ID を返す */
  const labelId = (list: Label[], kind: string, projectId: string, name: string): string => {
    const key = `${kind}\u0000${projectId}\u0000${name}`;
    const existing = known.get(key);
    if (existing) {
      return existing;
    }
    const order = list.filter((label) => label.projectId === projectId).length;
    const label: Label = {
      id: newId(),
      projectId,
      name,
      order,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    list.push(label);
    known.set(key, label.id);
    return label.id;
  };

  const masters: Master[] = [];
  for (const raw of backup.masters as LegacyBackupMaster[]) {
    const { category, tags: legacyTags, ...rest } = raw;
    const master: Master = { ...rest, tagIds: [...(rest.tagIds ?? [])] };
    const categoryName = category?.trim();
    if (!master.categoryId && categoryName) {
      master.categoryId = labelId(categories, 'category', master.projectId, categoryName);
    }
    for (const legacy of legacyTags ?? []) {
      const name = legacy.trim();
      if (!name) {
        continue;
      }
      const id = labelId(tags, 'tag', master.projectId, name);
      if (!master.tagIds.includes(id)) {
        master.tagIds.push(id);
      }
    }
    masters.push(master);
  }

  return { ...backup, categories, tags, masters };
}

/** version 3 以前の Master。カテゴリとタグを文字列で持っていた */
type LegacyBackupMaster = Master & { category?: string; tags?: string[] };

/**
 * 全 ID を新規採番し、外部キー（projectId / caseId / masterId / categoryId / tagIds）も
 * 新旧 ID の対応表で一貫して差し替える。参照が壊れるレコードは取り込まない。
 */
function remapIds(backup: BackupFile): BackupFile {
  const projectIds = new Map(backup.projects.map((p) => [p.id, newId()]));
  const caseIds = new Map(backup.cases.map((c) => [c.id, newId()]));
  const masterIds = new Map(backup.masters.map((m) => [m.id, newId()]));
  const categoryIds = new Map((backup.categories ?? []).map((c) => [c.id, newId()]));
  const tagIds = new Map((backup.tags ?? []).map((t) => [t.id, newId()]));

  const projects = backup.projects.map((p) => ({ ...p, id: projectIds.get(p.id) as string }));

  const cases: Case[] = [];
  for (const c of backup.cases) {
    const projectId = projectIds.get(c.projectId);
    const id = caseIds.get(c.id);
    if (projectId && id) {
      cases.push({ ...c, id, projectId });
    }
  }

  const categories = remapLabels(backup.categories ?? [], categoryIds, projectIds);
  const tags = remapLabels(backup.tags ?? [], tagIds, projectIds);

  const masters: Master[] = [];
  for (const m of backup.masters) {
    const projectId = projectIds.get(m.projectId);
    const id = masterIds.get(m.id);
    if (!projectId || !id) {
      continue;
    }
    const master: Master = {
      ...m,
      id,
      projectId,
      // 参照先が無いカテゴリ / タグは落とし、オブジェクト自体は取り込む
      tagIds: (m.tagIds ?? []).map((tagId) => tagIds.get(tagId)).filter(isPresent),
    };
    const categoryId = m.categoryId ? categoryIds.get(m.categoryId) : undefined;
    if (categoryId) {
      master.categoryId = categoryId;
    } else {
      delete master.categoryId;
    }
    masters.push(master);
  }

  const images: BackupProjectImage[] = [];
  for (const image of backup.images ?? []) {
    const projectId = projectIds.get(image.projectId);
    if (projectId) {
      images.push({ ...image, projectId });
    }
  }

  const masterImages: BackupMasterImage[] = [];
  for (const image of backup.masterImages ?? []) {
    const projectId = projectIds.get(image.projectId);
    const masterId = masterIds.get(image.masterId);
    if (projectId && masterId) {
      masterImages.push({ ...image, projectId, masterId });
    }
  }

  const instances: Instance[] = [];
  for (const i of backup.instances) {
    const projectId = projectIds.get(i.projectId);
    const caseId = caseIds.get(i.caseId);
    const masterId = masterIds.get(i.masterId);
    if (projectId && caseId && masterId) {
      instances.push({ ...i, id: newId(), projectId, caseId, masterId });
    }
  }

  return { ...backup, projects, cases, categories, tags, masters, instances, images, masterImages };
}

/** 分類マスタの ID と projectId を対応表で差し替える */
function remapLabels(
  labels: readonly Label[],
  labelIds: ReadonlyMap<string, string>,
  projectIds: ReadonlyMap<string, string>,
): Label[] {
  const remapped: Label[] = [];
  for (const label of labels) {
    const projectId = projectIds.get(label.projectId);
    const id = labelIds.get(label.id);
    if (projectId && id) {
      remapped.push({ ...label, id, projectId });
    }
  }
  return remapped;
}

function isPresent(value: string | undefined): value is string {
  return value !== undefined;
}

/** 保存済みの画像を JSON に載せられる形にする */
function encodeImage(image: StoredImage): BackupImage {
  return {
    data: bytesToBase64(image.data),
    type: image.type,
    width: image.width,
    height: image.height,
    updatedAt: image.updatedAt,
  };
}

/** base64 の画像を保存できる形に戻す。壊れている 1 枚のためにインポート全体を失敗させない */
function decodeImage(image: BackupImage): StoredImage | null {
  if (typeof image?.data !== 'string') {
    return null;
  }
  try {
    const data = base64ToBytes(image.data);
    return {
      data,
      type: image.type || 'image/png',
      width: image.width ?? 0,
      height: image.height ?? 0,
      size: data.byteLength,
      updatedAt: image.updatedAt ?? nowIso(),
    };
  } catch {
    return null;
  }
}

function decodeProjectImages(images: readonly BackupProjectImage[]): ProjectImage[] {
  const decoded: ProjectImage[] = [];
  for (const image of images) {
    const body = decodeImage(image);
    if (body && typeof image.projectId === 'string') {
      decoded.push({ projectId: image.projectId, ...body });
    }
  }
  return decoded;
}

function decodeMasterImages(images: readonly BackupMasterImage[]): MasterImage[] {
  const decoded: MasterImage[] = [];
  for (const image of images) {
    const body = decodeImage(image);
    if (body && typeof image.masterId === 'string' && typeof image.projectId === 'string') {
      decoded.push({ masterId: image.masterId, projectId: image.projectId, ...body });
    }
  }
  return decoded;
}
