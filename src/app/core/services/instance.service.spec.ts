import { TestBed } from '@angular/core/testing';
import { resetDatabase } from '../db/db.spec-helper';
import { InstanceRepository } from '../repositories/instance.repository';
import { CaseService } from './case.service';
import { InstanceService } from './instance.service';
import { MasterService } from './master.service';
import { ProjectService } from './project.service';

describe('InstanceService', () => {
  let instances: InstanceService;
  let repository: InstanceRepository;
  let projectId: string;
  let caseId: string;
  let masterId: string;

  beforeEach(async () => {
    await resetDatabase();
    TestBed.configureTestingModule({});
    instances = TestBed.inject(InstanceService);
    repository = TestBed.inject(InstanceRepository);
    projectId = (await TestBed.inject(ProjectService).create('ゲームA')).id;
    caseId = (await TestBed.inject(CaseService).create(projectId, '1章')).id;
    masterId = (await TestBed.inject(MasterService).create(projectId, { name: '鉄鉱石' })).id;
  });

  it('初回追加で新規レコードを作り projectId を冗長保持する', async () => {
    await instances.addToCase(caseId, masterId, 3);

    const stored = await repository.getByCase(caseId);
    expect(stored).toHaveLength(1);
    expect(stored[0].qty).toBe(3);
    expect(stored[0].projectId).toBe(projectId);
  });

  it('同じケースの同じマスターは 1 レコードに集約して加算する', async () => {
    await instances.addToCase(caseId, masterId, 3);
    await instances.addToCase(caseId, masterId, 2);

    const stored = await repository.getByCase(caseId);
    expect(stored).toHaveLength(1);
    expect(stored[0].qty).toBe(5);
  });

  it('負数を渡すと減算される', async () => {
    await instances.addToCase(caseId, masterId, 5);
    await instances.addToCase(caseId, masterId, -2);

    expect((await repository.getByCase(caseId))[0].qty).toBe(3);
  });

  it('加算の結果が負になっても 0 で止まり、レコードは残る', async () => {
    await instances.addToCase(caseId, masterId, 2);
    await instances.addToCase(caseId, masterId, -5);

    const stored = await repository.getByCase(caseId);
    expect(stored).toHaveLength(1);
    expect(stored[0].qty).toBe(0);
  });

  it('0 個のレコードを新規作成できる', async () => {
    await instances.addToCase(caseId, masterId, 0);

    const stored = await repository.getByCase(caseId);
    expect(stored).toHaveLength(1);
    expect(stored[0].qty).toBe(0);
  });

  it('存在しないマスターを負数で追加しても新規作成しない', async () => {
    await instances.addToCase(caseId, masterId, -1);

    expect(await repository.getByCase(caseId)).toEqual([]);
  });

  it('存在しないケースへの追加は NotFoundError になる', async () => {
    await expect(instances.addToCase('missing', masterId, 1)).rejects.toThrow(/見つかりません/);
  });

  it('setQty で数量を直接指定できる', async () => {
    await instances.addToCase(caseId, masterId, 1);
    const target = (await repository.getByCase(caseId))[0];

    await instances.setQty(target.id, 10);

    expect((await repository.getByCase(caseId))[0].qty).toBe(10);
  });

  it('setQty に 0 を渡してもレコードは残る', async () => {
    await instances.addToCase(caseId, masterId, 1);
    const target = (await repository.getByCase(caseId))[0];

    await instances.setQty(target.id, 0);

    const stored = await repository.getByCase(caseId);
    expect(stored).toHaveLength(1);
    expect(stored[0].qty).toBe(0);
  });

  it('setQty に負数を渡すと 0 に丸める', async () => {
    await instances.addToCase(caseId, masterId, 1);
    const target = (await repository.getByCase(caseId))[0];

    await instances.setQty(target.id, -3);

    expect((await repository.getByCase(caseId))[0].qty).toBe(0);
  });

  it('一覧行にマスター名が結合される', async () => {
    await instances.addToCase(caseId, masterId, 1);

    expect(instances.rows()[0].masterName).toBe('鉄鉱石');
    expect(instances.totalQty()).toBe(1);
  });
});
