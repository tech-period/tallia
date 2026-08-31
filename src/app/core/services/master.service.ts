import { Service, computed, inject, signal } from '@angular/core';
import { runTransaction } from '../db/database';
import { Case, Instance, Master } from '../db/schema';
import { CaseRepository } from '../repositories/case.repository';
import { InstanceRepository } from '../repositories/instance.repository';
import { MasterImageRepository } from '../repositories/master-image.repository';
import { MasterRepository } from '../repositories/master.repository';
import { newId, nowIso } from '../../shared/utils/id';
import { MasterInUseError, NotFoundError } from './errors';
import { MasterImageService } from './master-image.service';

/** マスターがどのケースで何個使われているか */
export interface MasterUsage {
  caseId: string;
  caseName: string;
  qty: number;
}

@Service()
export class MasterService {
  private readonly masters = inject(MasterRepository);
  private readonly cases = inject(CaseRepository);
  private readonly instances = inject(InstanceRepository);
  private readonly imageRecords = inject(MasterImageRepository);
  private readonly images = inject(MasterImageService);

  private readonly projectIdSignal = signal<string | null>(null);
  private readonly mastersSignal = signal<readonly Master[]>([]);
  private readonly usageSignal = signal<ReadonlyMap<string, readonly MasterUsage[]>>(new Map());
  private readonly loadedSignal = signal(false);

  /** 名前順のマスター一覧 */
  readonly all = this.mastersSignal.asReadonly();
  readonly usage = this.usageSignal.asReadonly();
  readonly loaded = this.loadedSignal.asReadonly();
  readonly projectId = this.projectIdSignal.asReadonly();
  readonly isEmpty = computed(() => this.loadedSignal() && this.mastersSignal().length === 0);

  /** 絞り込み UI 用に、登録済みカテゴリを重複なく返す */
  readonly categories = computed(() => {
    const set = new Set<string>();
    for (const master of this.mastersSignal()) {
      if (master.category) {
        set.add(master.category);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ja'));
  });

  /** 絞り込み UI 用に、登録済みタグを重複なく返す */
  readonly tags = computed(() => {
    const set = new Set<string>();
    for (const master of this.mastersSignal()) {
      for (const tag of master.tags) {
        set.add(tag);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ja'));
  });

  async load(projectId: string): Promise<void> {
    this.projectIdSignal.set(projectId);
    const [masters, cases, instances] = await Promise.all([
      this.masters.getByProject(projectId),
      this.cases.getByProject(projectId),
      this.instances.getByProject(projectId),
    ]);
    masters.sort((a, b) => a.name.localeCompare(b.name, 'ja'));

    this.mastersSignal.set(masters);
    this.usageSignal.set(buildUsage(cases, instances));
    this.loadedSignal.set(true);
  }

  async getById(id: string): Promise<Master | undefined> {
    return this.masters.getById(id);
  }

  async create(
    projectId: string,
    input: { name: string; category?: string; tags?: readonly string[]; note?: string },
  ): Promise<Master> {
    const name = input.name.trim();
    const duplicate = await this.masters.findByName(projectId, name);
    if (duplicate) {
      throw new Error(
        `「${name}」は既に登録されています。別の名前にするか、既存のオブジェクトを編集してください。`,
      );
    }
    const timestamp = nowIso();
    const created: Master = {
      id: newId(),
      projectId,
      name,
      ...(input.category?.trim() ? { category: input.category.trim() } : {}),
      tags: normalizeTags(input.tags),
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.masters.put(created);
    await this.load(projectId);
    return created;
  }

  async update(
    id: string,
    changes: { name?: string; category?: string; tags?: readonly string[]; note?: string },
  ): Promise<Master> {
    const current = await this.masters.getById(id);
    if (!current) {
      throw new NotFoundError('オブジェクト', id);
    }
    const name = changes.name?.trim() ?? current.name;
    if (name !== current.name) {
      const duplicate = await this.masters.findByName(current.projectId, name);
      if (duplicate && duplicate.id !== id) {
        throw new Error(`「${name}」は既に登録されています。別の名前を入力してください。`);
      }
    }

    const updated: Master = { ...current, name, updatedAt: nowIso() };
    if (changes.category !== undefined) {
      const category = changes.category.trim();
      if (category) {
        updated.category = category;
      } else {
        delete updated.category;
      }
    }
    if (changes.tags !== undefined) {
      updated.tags = normalizeTags(changes.tags);
    }
    if (changes.note !== undefined) {
      const note = changes.note.trim();
      if (note) {
        updated.note = note;
      } else {
        delete updated.note;
      }
    }

    await this.masters.put(updated);
    await this.load(current.projectId);
    return updated;
  }

  /** 参照している Instance が 1 件でもあれば削除を拒否する */
  async delete(masterId: string): Promise<void> {
    const current = await this.masters.getById(masterId);
    if (!current) {
      throw new NotFoundError('オブジェクト', masterId);
    }
    await runTransaction(async (tx) => {
      const usageCount = await this.instances.countByMaster(masterId, tx);
      if (usageCount > 0) {
        throw new MasterInUseError(masterId, usageCount);
      }
      await this.imageRecords.deleteByMaster(masterId, tx);
      await this.masters.delete(masterId, tx);
    });
    this.images.forget(masterId);
    await this.load(current.projectId);
  }
}

function normalizeTags(tags: readonly string[] | undefined): string[] {
  if (!tags) {
    return [];
  }
  const seen = new Set<string>();
  for (const tag of tags) {
    const trimmed = tag.trim();
    if (trimmed) {
      seen.add(trimmed);
    }
  }
  return [...seen];
}

function buildUsage(
  cases: readonly Case[],
  instances: readonly Instance[],
): ReadonlyMap<string, readonly MasterUsage[]> {
  const caseNames = new Map(cases.map((c) => [c.id, c.name]));
  const ordered = new Map(cases.map((c) => [c.id, c.order]));
  const usage = new Map<string, MasterUsage[]>();
  for (const instance of instances) {
    const list = usage.get(instance.masterId) ?? [];
    list.push({
      caseId: instance.caseId,
      caseName: caseNames.get(instance.caseId) ?? '(削除されたケース)',
      qty: instance.qty,
    });
    usage.set(instance.masterId, list);
  }
  for (const list of usage.values()) {
    list.sort((a, b) => (ordered.get(a.caseId) ?? 0) - (ordered.get(b.caseId) ?? 0));
  }
  return usage;
}
