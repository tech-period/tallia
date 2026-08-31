import { computed, inject, signal } from '@angular/core';
import { runTransaction, TalliaTransaction } from '../db/database';
import { Label, Master } from '../db/schema';
import { MasterRepository } from '../repositories/master.repository';
import { newId, nowIso } from '../../shared/utils/id';
import { LabelInUseError, NotFoundError } from './errors';

/**
 * カテゴリ / タグを保存する Repository に求める操作。
 * `CategoryRepository` と `TagRepository` がそのまま満たす。
 */
export interface LabelStore {
  getByProject(projectId: string, tx?: TalliaTransaction): Promise<Label[]>;
  getById(id: string, tx?: TalliaTransaction): Promise<Label | undefined>;
  findByName(projectId: string, name: string, tx?: TalliaTransaction): Promise<Label | undefined>;
  put(label: Label, tx?: TalliaTransaction): Promise<void>;
  delete(id: string, tx?: TalliaTransaction): Promise<void>;
}

/** どのオブジェクトで使われているか */
export interface LabelUsage {
  masterId: string;
  masterName: string;
}

/**
 * カテゴリとタグに共通する管理ロジック。
 *
 * 違いは「どの Repository に保存するか」「Master のどの項目から参照されるか」の
 * 2 点だけなので、サブクラスではそこだけを埋める。
 */
export abstract class LabelService {
  /** 保存先。サブクラスで `inject()` した Repository を渡す */
  protected abstract readonly repository: LabelStore;
  /** 利用者向けの呼び名（「カテゴリ」「タグ」） */
  protected abstract readonly entityName: string;
  /** `master` がこの分類を参照しているか */
  protected abstract usedBy(master: Master, labelId: string): boolean;

  private readonly masters = inject(MasterRepository);

  private readonly projectIdSignal = signal<string | null>(null);
  private readonly labelsSignal = signal<readonly Label[]>([]);
  private readonly usageSignal = signal<ReadonlyMap<string, readonly LabelUsage[]>>(new Map());
  private readonly loadedSignal = signal(false);

  /** `order` 昇順の一覧 */
  readonly all = this.labelsSignal.asReadonly();
  /** 分類 ID ごとの、使用中オブジェクト */
  readonly usage = this.usageSignal.asReadonly();
  readonly loaded = this.loadedSignal.asReadonly();
  readonly projectId = this.projectIdSignal.asReadonly();
  readonly isEmpty = computed(() => this.loadedSignal() && this.labelsSignal().length === 0);
  /** ID から名前を引くための対応表。一覧表示で 1 件ずつ検索しないために持つ */
  readonly namesById = computed(() => new Map(this.labelsSignal().map((l) => [l.id, l.name])));

  async load(projectId: string): Promise<void> {
    this.projectIdSignal.set(projectId);
    const [labels, masters] = await Promise.all([
      this.repository.getByProject(projectId),
      this.masters.getByProject(projectId),
    ]);
    labels.sort((a, b) => a.order - b.order);

    const usage = new Map<string, LabelUsage[]>();
    for (const label of labels) {
      const used = masters
        .filter((master) => this.usedBy(master, label.id))
        .map((master) => ({ masterId: master.id, masterName: master.name }));
      used.sort((a, b) => a.masterName.localeCompare(b.masterName, 'ja'));
      usage.set(label.id, used);
    }

    this.labelsSignal.set(labels);
    this.usageSignal.set(usage);
    this.loadedSignal.set(true);
  }

  async getById(id: string): Promise<Label | undefined> {
    return this.repository.getById(id);
  }

  /** 名前は同一プロジェクト内で一意。末尾に追加する */
  async create(projectId: string, name: string): Promise<Label> {
    const trimmed = name.trim();
    const duplicate = await this.repository.findByName(projectId, trimmed);
    if (duplicate) {
      throw new Error(`「${trimmed}」は既に登録されている${this.entityName}です。`);
    }
    const existing = await this.repository.getByProject(projectId);
    const maxOrder = existing.reduce((max, label) => Math.max(max, label.order), -1);
    const timestamp = nowIso();
    const created: Label = {
      id: newId(),
      projectId,
      name: trimmed,
      order: maxOrder + 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.repository.put(created);
    await this.load(projectId);
    return created;
  }

  /** 名前を変える。参照している Master は ID 参照なので書き換え不要 */
  async update(id: string, name: string): Promise<Label> {
    const current = await this.repository.getById(id);
    if (!current) {
      throw new NotFoundError(this.entityName, id);
    }
    const trimmed = name.trim();
    if (trimmed !== current.name) {
      const duplicate = await this.repository.findByName(current.projectId, trimmed);
      if (duplicate && duplicate.id !== id) {
        throw new Error(`「${trimmed}」は既に登録されている${this.entityName}です。`);
      }
    }
    const updated: Label = { ...current, name: trimmed, updatedAt: nowIso() };
    await this.repository.put(updated);
    await this.load(current.projectId);
    return updated;
  }

  /** 1 つ上／下へ動かし、同一プロジェクト内の `order` を連番に振り直す */
  async move(id: string, direction: -1 | 1): Promise<void> {
    const ordered = [...this.labelsSignal()].sort((a, b) => a.order - b.order);
    const index = ordered.findIndex((label) => label.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) {
      return;
    }
    const moving = ordered[index];
    ordered[index] = ordered[target];
    ordered[target] = moving;

    const timestamp = nowIso();
    await runTransaction(async (tx) => {
      for (const [order, label] of ordered.entries()) {
        if (label.order !== order) {
          await this.repository.put({ ...label, order, updatedAt: timestamp }, tx);
        }
      }
    });
    await this.load(moving.projectId);
  }

  /** 参照しているオブジェクトが 1 件でもあれば削除を拒否する */
  async delete(id: string): Promise<void> {
    const current = await this.repository.getById(id);
    if (!current) {
      throw new NotFoundError(this.entityName, id);
    }
    await runTransaction(async (tx) => {
      const masters = await this.masters.getByProject(current.projectId, tx);
      const usageCount = masters.filter((master) => this.usedBy(master, id)).length;
      if (usageCount > 0) {
        throw new LabelInUseError(this.entityName, id, usageCount);
      }
      await this.repository.delete(id, tx);
    });
    await this.load(current.projectId);
  }

  /** 削除確認に出す使用件数 */
  async countUsage(id: string): Promise<number> {
    const current = await this.repository.getById(id);
    if (!current) {
      return 0;
    }
    const masters = await this.masters.getByProject(current.projectId);
    return masters.filter((master) => this.usedBy(master, id)).length;
  }
}
