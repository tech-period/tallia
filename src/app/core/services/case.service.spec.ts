import { TestBed } from '@angular/core/testing';
import { resetDatabase } from '../db/db.spec-helper';
import { InstanceRepository } from '../repositories/instance.repository';
import { CaseService } from './case.service';
import { InstanceService } from './instance.service';
import { MasterService } from './master.service';
import { ProjectService } from './project.service';

describe('CaseService', () => {
  let cases: CaseService;
  let projectId: string;

  beforeEach(async () => {
    await resetDatabase();
    TestBed.configureTestingModule({});
    cases = TestBed.inject(CaseService);
    projectId = (await TestBed.inject(ProjectService).create('ゲームA')).id;
  });

  it('order は同一プロジェクト内で連番になる', async () => {
    await cases.create(projectId, '1章');
    await cases.create(projectId, '2章');
    await cases.create(projectId, '3章');

    expect(cases.all().map((c) => c.order)).toEqual([0, 1, 2]);
    expect(cases.all().map((c) => c.name)).toEqual(['1章', '2章', '3章']);
  });

  it('並び替えで order が振り直される', async () => {
    await cases.create(projectId, '1章');
    const second = await cases.create(projectId, '2章');
    await cases.create(projectId, '3章');

    await cases.move(second.id, -1);

    expect(cases.all().map((c) => c.name)).toEqual(['2章', '1章', '3章']);
    expect(cases.all().map((c) => c.order)).toEqual([0, 1, 2]);
  });

  it('先頭を上へ動かしても何も変わらない', async () => {
    const first = await cases.create(projectId, '1章');
    await cases.create(projectId, '2章');

    await cases.move(first.id, -1);

    expect(cases.all().map((c) => c.name)).toEqual(['1章', '2章']);
  });

  it('数量合計をケースごとに集計する', async () => {
    const masters = TestBed.inject(MasterService);
    const instances = TestBed.inject(InstanceService);
    const first = await cases.create(projectId, '1章');
    const second = await cases.create(projectId, '2章');
    const iron = await masters.create(projectId, { name: '鉄鉱石' });
    const copper = await masters.create(projectId, { name: '銅鉱石' });

    await instances.addToCase(first.id, iron.id, 3);
    await instances.addToCase(first.id, copper.id, 4);
    await instances.addToCase(second.id, iron.id, 5);
    await cases.load(projectId);

    expect(cases.totals().get(first.id)).toBe(7);
    expect(cases.totals().get(second.id)).toBe(5);
  });

  it('削除すると配下の Instance がカスケード削除される', async () => {
    const masters = TestBed.inject(MasterService);
    const instances = TestBed.inject(InstanceService);
    const target = await cases.create(projectId, '消す方');
    const keep = await cases.create(projectId, '残す方');
    const master = await masters.create(projectId, { name: '鉄鉱石' });
    await instances.addToCase(target.id, master.id, 2);
    await instances.addToCase(keep.id, master.id, 1);

    await cases.delete(target.id);

    const repository = TestBed.inject(InstanceRepository);
    expect(await repository.getByCase(target.id)).toEqual([]);
    expect(await repository.getByCase(keep.id)).toHaveLength(1);
    expect(cases.all().map((c) => c.name)).toEqual(['残す方']);
  });
});
