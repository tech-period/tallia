import { Service, computed, inject, signal } from '@angular/core';
import { runTransaction } from '../db/database';
import { Case } from '../db/schema';
import { CaseRepository } from '../repositories/case.repository';
import { InstanceRepository } from '../repositories/instance.repository';
import { newId, nowIso } from '../../shared/utils/id';
import { NotFoundError } from './errors';

@Service()
export class CaseService {
  private readonly cases = inject(CaseRepository);
  private readonly instances = inject(InstanceRepository);

  private readonly projectIdSignal = signal<string | null>(null);
  private readonly casesSignal = signal<readonly Case[]>([]);
  private readonly totalsSignal = signal<ReadonlyMap<string, number>>(new Map());
  private readonly loadedSignal = signal(false);

  /** `order` 昇順のケース一覧 */
  readonly all = this.casesSignal.asReadonly();
  /** ケースごとの数量合計 */
  readonly totals = this.totalsSignal.asReadonly();
  readonly loaded = this.loadedSignal.asReadonly();
  readonly projectId = this.projectIdSignal.asReadonly();
  readonly isEmpty = computed(() => this.loadedSignal() && this.casesSignal().length === 0);

  /** 表示中プロジェクトのケースと、その数量合計だけを読み込む */
  async load(projectId: string): Promise<void> {
    this.projectIdSignal.set(projectId);
    const [cases, instances] = await Promise.all([
      this.cases.getByProject(projectId),
      this.instances.getByProject(projectId),
    ]);
    cases.sort((a, b) => a.order - b.order);

    const totals = new Map<string, number>();
    for (const instance of instances) {
      totals.set(instance.caseId, (totals.get(instance.caseId) ?? 0) + instance.qty);
    }

    this.casesSignal.set(cases);
    this.totalsSignal.set(totals);
    this.loadedSignal.set(true);
  }

  async getById(id: string): Promise<Case | undefined> {
    return this.cases.getById(id);
  }

  async create(projectId: string, name: string, note?: string): Promise<Case> {
    const existing = await this.cases.getByProject(projectId);
    const maxOrder = existing.reduce((max, c) => Math.max(max, c.order), -1);
    const timestamp = nowIso();
    const created: Case = {
      id: newId(),
      projectId,
      name: name.trim(),
      ...(note?.trim() ? { note: note.trim() } : {}),
      order: maxOrder + 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.cases.put(created);
    await this.load(projectId);
    return created;
  }

  async update(id: string, changes: { name?: string; note?: string }): Promise<Case> {
    const current = await this.cases.getById(id);
    if (!current) {
      throw new NotFoundError('ケース', id);
    }
    const updated: Case = {
      ...current,
      name: changes.name?.trim() ?? current.name,
      updatedAt: nowIso(),
    };
    if (changes.note !== undefined) {
      const note = changes.note.trim();
      if (note) {
        updated.note = note;
      } else {
        delete updated.note;
      }
    }
    await this.cases.put(updated);
    await this.load(current.projectId);
    return updated;
  }

  /** ケースを 1 つ上／下へ動かし、同一プロジェクト内の `order` を連番に振り直す */
  async move(id: string, direction: -1 | 1): Promise<void> {
    const ordered = [...this.casesSignal()].sort((a, b) => a.order - b.order);
    const index = ordered.findIndex((c) => c.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) {
      return;
    }
    const moving = ordered[index];
    ordered[index] = ordered[target];
    ordered[target] = moving;

    const timestamp = nowIso();
    await runTransaction(async (tx) => {
      for (const [order, c] of ordered.entries()) {
        if (c.order !== order) {
          await this.cases.put({ ...c, order, updatedAt: timestamp }, tx);
        }
      }
    });
    await this.load(moving.projectId);
  }

  /** 配下の Instance を含めて単一トランザクションで削除する */
  async delete(id: string): Promise<void> {
    const current = await this.cases.getById(id);
    if (!current) {
      throw new NotFoundError('ケース', id);
    }
    await runTransaction(async (tx) => {
      await this.instances.deleteByCase(id, tx);
      await this.cases.delete(id, tx);
    });
    await this.load(current.projectId);
  }

  /** 削除確認に出すインスタンス件数 */
  async countInstances(caseId: string): Promise<number> {
    const list = await this.instances.getByCase(caseId);
    return list.length;
  }
}
