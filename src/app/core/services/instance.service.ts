import { Service, computed, inject, signal } from '@angular/core';
import { runTransaction } from '../db/database';
import { Instance } from '../db/schema';
import { CaseRepository } from '../repositories/case.repository';
import { CategoryRepository } from '../repositories/category.repository';
import { InstanceRepository } from '../repositories/instance.repository';
import { MasterRepository } from '../repositories/master.repository';
import { TagRepository } from '../repositories/tag.repository';
import { newId, nowIso } from '../../shared/utils/id';
import { NotFoundError } from './errors';

/** 一覧表示用に、Instance にマスター情報を添えたもの。分類は名前に解決して持つ */
export interface InstanceRow {
  instance: Instance;
  masterName: string;
  masterCategory?: string;
  masterTags: readonly string[];
}

@Service()
export class InstanceService {
  private readonly instances = inject(InstanceRepository);
  private readonly masters = inject(MasterRepository);
  private readonly categories = inject(CategoryRepository);
  private readonly tags = inject(TagRepository);
  private readonly cases = inject(CaseRepository);

  private readonly caseIdSignal = signal<string | null>(null);
  private readonly rowsSignal = signal<readonly InstanceRow[]>([]);
  private readonly loadedSignal = signal(false);

  readonly rows = this.rowsSignal.asReadonly();
  readonly loaded = this.loadedSignal.asReadonly();
  readonly caseId = this.caseIdSignal.asReadonly();
  readonly isEmpty = computed(() => this.loadedSignal() && this.rowsSignal().length === 0);
  readonly totalQty = computed(() =>
    this.rowsSignal().reduce((sum, row) => sum + row.instance.qty, 0),
  );

  /** `by-case` インデックスで、表示中のケース分だけを読み込む */
  async load(caseId: string, projectId: string): Promise<void> {
    this.caseIdSignal.set(caseId);
    this.rowsSignal.set(await this.rowsForCase(caseId, projectId));
    this.loadedSignal.set(true);
  }

  /**
   * 1 ケース分の行を組み立てて返すだけで、表示中ケースの状態は変えない。
   * ケース展開ビューのように複数ケースを同時に扱う画面から使う。
   */
  async rowsForCase(caseId: string, projectId: string): Promise<readonly InstanceRow[]> {
    const [instances, masters, categories, tags] = await Promise.all([
      this.instances.getByCase(caseId),
      this.masters.getByProject(projectId),
      this.categories.getByProject(projectId),
      this.tags.getByProject(projectId),
    ]);
    const byId = new Map(masters.map((m) => [m.id, m]));
    // 表示は名前で行うため、ここで ID を名前に解決する
    const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
    const tagOrder = new Map(tags.map((t) => [t.id, t.order]));
    const tagNames = new Map(tags.map((t) => [t.id, t.name]));
    const rows: InstanceRow[] = instances.map((instance) => {
      const master = byId.get(instance.masterId);
      const category = master?.categoryId ? categoryNames.get(master.categoryId) : undefined;
      const masterTags = (master?.tagIds ?? [])
        .filter((id) => tagNames.has(id))
        .sort((a, b) => (tagOrder.get(a) ?? 0) - (tagOrder.get(b) ?? 0))
        .map((id) => tagNames.get(id) as string);
      return {
        instance,
        masterName: master?.name ?? '(削除されたオブジェクト)',
        ...(category ? { masterCategory: category } : {}),
        masterTags,
      };
    });
    rows.sort((a, b) => a.masterName.localeCompare(b.masterName, 'ja'));
    return rows;
  }

  /**
   * ケースにマスターを追加する。既存レコードがあれば新規作成せず `qty` に加算する。
   * `qty` は 0 も正しい値として扱い、減算した結果が負になる場合は 0 で止める
   * （レコードは残す。消すのは明示的な削除操作だけ）。
   */
  async addToCase(caseId: string, masterId: string, qty = 1): Promise<void> {
    const delta = Math.trunc(qty);
    if (!Number.isFinite(delta)) {
      return;
    }

    const projectId = await runTransaction(async (tx) => {
      const target = await this.cases.getById(caseId, tx);
      if (!target) {
        throw new NotFoundError('ケース', caseId);
      }
      const master = await this.masters.getById(masterId, tx);
      if (!master) {
        throw new NotFoundError('オブジェクト', masterId);
      }

      const timestamp = nowIso();
      const existing = await this.instances.findByCaseAndMaster(caseId, masterId, tx);
      if (existing) {
        const nextQty = Math.max(0, existing.qty + delta);
        if (nextQty !== existing.qty) {
          await this.instances.put({ ...existing, qty: nextQty, updatedAt: timestamp }, tx);
        }
      } else if (delta >= 0) {
        const created: Instance = {
          id: newId(),
          projectId: target.projectId,
          caseId,
          masterId,
          qty: delta,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        await this.instances.put(created, tx);
      }
      return target.projectId;
    });

    await this.load(caseId, projectId);
  }

  /** 数量を直接指定する。0 は正しい値として保存し、負数は 0 に丸める */
  async setQty(instanceId: string, qty: number): Promise<void> {
    const current = await this.instances.getById(instanceId);
    if (!current) {
      throw new NotFoundError('インスタンス', instanceId);
    }
    const next = Math.trunc(qty);
    if (!Number.isFinite(next)) {
      return;
    }
    await this.instances.put({ ...current, qty: Math.max(0, next), updatedAt: nowIso() });
    await this.load(current.caseId, current.projectId);
  }

  async updateNote(instanceId: string, note: string): Promise<void> {
    const current = await this.instances.getById(instanceId);
    if (!current) {
      throw new NotFoundError('インスタンス', instanceId);
    }
    const updated: Instance = { ...current, updatedAt: nowIso() };
    const trimmed = note.trim();
    if (trimmed) {
      updated.note = trimmed;
    } else {
      delete updated.note;
    }
    await this.instances.put(updated);
    await this.load(current.caseId, current.projectId);
  }

  async delete(instanceId: string): Promise<void> {
    const current = await this.instances.getById(instanceId);
    if (!current) {
      throw new NotFoundError('インスタンス', instanceId);
    }
    await this.instances.delete(instanceId);
    await this.load(current.caseId, current.projectId);
  }
}
