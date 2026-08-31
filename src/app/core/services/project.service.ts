import { Service, computed, inject, signal } from '@angular/core';
import { runTransaction } from '../db/database';
import { Project } from '../db/schema';
import { CaseRepository } from '../repositories/case.repository';
import { CategoryRepository } from '../repositories/category.repository';
import { InstanceRepository } from '../repositories/instance.repository';
import { MasterImageRepository } from '../repositories/master-image.repository';
import { MasterRepository } from '../repositories/master.repository';
import { ProjectImageRepository } from '../repositories/project-image.repository';
import { ProjectRepository } from '../repositories/project.repository';
import { TagRepository } from '../repositories/tag.repository';
import { newId, nowIso } from '../../shared/utils/id';
import { NotFoundError } from './errors';
import { MasterImageService } from './master-image.service';
import { ProjectImageService } from './project-image.service';

/** プロジェクト一覧のカードに出す件数 */
export interface ProjectStats {
  caseCount: number;
  masterCount: number;
}

/** プロジェクトメニューの各マスタに出す件数 */
export interface ProjectMenuCounts extends ProjectStats {
  categoryCount: number;
  tagCount: number;
}

@Service()
export class ProjectService {
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

  private readonly projectsSignal = signal<readonly Project[]>([]);
  private readonly statsSignal = signal<ReadonlyMap<string, ProjectStats>>(new Map());
  private readonly loadedSignal = signal(false);

  /** 名前順のプロジェクト一覧 */
  readonly all = this.projectsSignal.asReadonly();
  readonly stats = this.statsSignal.asReadonly();
  readonly loaded = this.loadedSignal.asReadonly();
  readonly isEmpty = computed(() => this.loadedSignal() && this.projectsSignal().length === 0);

  /** 一覧と件数を読み込む。起動時に読むのはここまでで、インスタンスは読み込まない */
  async load(): Promise<void> {
    const all = await this.projects.getAll();
    all.sort((a, b) => a.name.localeCompare(b.name, 'ja'));

    const stats = new Map<string, ProjectStats>();
    for (const project of all) {
      const [caseCount, masterCount] = await Promise.all([
        this.cases.countByProject(project.id),
        this.masters.countByProject(project.id),
      ]);
      stats.set(project.id, { caseCount, masterCount });
    }

    this.projectsSignal.set(all);
    this.statsSignal.set(stats);
    this.loadedSignal.set(true);

    // 画像は件数が少ないためまとめて読む。更新のないものは URL を使い回す
    await this.images.loadAll();
  }

  async getById(id: string): Promise<Project | undefined> {
    return this.projects.getById(id);
  }

  async create(name: string, note?: string): Promise<Project> {
    const timestamp = nowIso();
    const project: Project = {
      id: newId(),
      name: name.trim(),
      ...(note?.trim() ? { note: note.trim() } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.projects.put(project);
    await this.load();
    return project;
  }

  async update(id: string, changes: { name?: string; note?: string }): Promise<Project> {
    const current = await this.projects.getById(id);
    if (!current) {
      throw new NotFoundError('プロジェクト', id);
    }
    const note = changes.note?.trim();
    const updated: Project = {
      ...current,
      name: changes.name?.trim() ?? current.name,
      updatedAt: nowIso(),
    };
    if (changes.note !== undefined) {
      if (note) {
        updated.note = note;
      } else {
        delete updated.note;
      }
    }
    await this.projects.put(updated);
    await this.load();
    return updated;
  }

  /** メニュー画面に出す件数。インデックスの件数だけを見てインスタンスは読み込まない */
  async countSummary(projectId: string): Promise<ProjectMenuCounts> {
    const [caseCount, masterCount, categoryCount, tagCount] = await Promise.all([
      this.cases.countByProject(projectId),
      this.masters.countByProject(projectId),
      this.categories.countByProject(projectId),
      this.tags.countByProject(projectId),
    ]);
    return { caseCount, masterCount, categoryCount, tagCount };
  }

  /** 削除確認ダイアログに出すための件数を数える */
  async countDescendants(projectId: string): Promise<{
    cases: number;
    masters: number;
    instances: number;
    categories: number;
    tags: number;
  }> {
    const [cases, masters, instances, categories, tags] = await Promise.all([
      this.cases.countByProject(projectId),
      this.masters.countByProject(projectId),
      this.instances.getByProject(projectId).then((list) => list.length),
      this.categories.countByProject(projectId),
      this.tags.countByProject(projectId),
    ]);
    return { cases, masters, instances, categories, tags };
  }

  /** 配下の Case / Category / Tag / Master / Instance を含めて単一トランザクションで削除する */
  async delete(projectId: string): Promise<void> {
    await runTransaction(async (tx) => {
      await this.instances.deleteByProject(projectId, tx);
      await this.cases.deleteByProject(projectId, tx);
      await this.masterImageRecords.deleteByProject(projectId, tx);
      await this.masters.deleteByProject(projectId, tx);
      await this.categories.deleteByProject(projectId, tx);
      await this.tags.deleteByProject(projectId, tx);
      await this.imageRecords.deleteByProject(projectId, tx);
      await this.projects.delete(projectId, tx);
    });
    this.images.forget(projectId);
    // オブジェクト画像の URL は表示中プロジェクト分しか持たないためまとめて解放する
    this.masterImages.forgetAll();
    await this.load();
  }
}
