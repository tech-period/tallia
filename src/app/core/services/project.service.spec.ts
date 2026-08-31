import { TestBed } from '@angular/core/testing';
import { resetDatabase } from '../db/db.spec-helper';
import { CaseRepository } from '../repositories/case.repository';
import { InstanceRepository } from '../repositories/instance.repository';
import { MasterRepository } from '../repositories/master.repository';
import { ProjectRepository } from '../repositories/project.repository';
import { CaseService } from './case.service';
import { InstanceService } from './instance.service';
import { MasterService } from './master.service';
import { ProjectService } from './project.service';

describe('ProjectService', () => {
  let projects: ProjectService;

  beforeEach(async () => {
    await resetDatabase();
    TestBed.configureTestingModule({});
    projects = TestBed.inject(ProjectService);
  });

  it('作成すると一覧と件数が読み込まれる', async () => {
    await projects.create('ゲームA', '  メモ  ');

    expect(projects.all()).toHaveLength(1);
    expect(projects.all()[0].name).toBe('ゲームA');
    expect(projects.all()[0].note).toBe('メモ');
    expect(projects.stats().get(projects.all()[0].id)).toEqual({ caseCount: 0, masterCount: 0 });
  });

  it('一覧は名前順に並ぶ', async () => {
    await projects.create('ゲームB');
    await projects.create('ゲームA');

    expect(projects.all().map((p) => p.name)).toEqual(['ゲームA', 'ゲームB']);
  });

  it('名前を変更でき updatedAt が進む', async () => {
    const created = await projects.create('旧名');

    const updated = await projects.update(created.id, { name: '新名' });

    expect(updated.name).toBe('新名');
    expect(updated.createdAt).toBe(created.createdAt);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(created.updatedAt));
  });

  it('メモを空文字にすると note が消える', async () => {
    const created = await projects.create('ゲームA', 'メモ');

    const updated = await projects.update(created.id, { note: '' });

    expect(updated.note).toBeUndefined();
  });

  it('存在しない ID の更新は NotFoundError になる', async () => {
    await expect(projects.update('missing', { name: 'x' })).rejects.toThrow(/見つかりません/);
  });

  it('削除すると配下の Case / Master / Instance がすべて消える', async () => {
    const cases = TestBed.inject(CaseService);
    const masters = TestBed.inject(MasterService);
    const instances = TestBed.inject(InstanceService);

    const target = await projects.create('消す方');
    const keep = await projects.create('残す方');
    const targetCase = await cases.create(target.id, 'ケース1');
    const targetMaster = await masters.create(target.id, { name: '鉄鉱石' });
    await instances.addToCase(targetCase.id, targetMaster.id, 3);

    const keepCase = await cases.create(keep.id, 'ケース1');
    const keepMaster = await masters.create(keep.id, { name: '銅鉱石' });
    await instances.addToCase(keepCase.id, keepMaster.id, 1);

    await projects.delete(target.id);

    expect(await TestBed.inject(ProjectRepository).getById(target.id)).toBeUndefined();
    expect(await TestBed.inject(CaseRepository).getByProject(target.id)).toEqual([]);
    expect(await TestBed.inject(MasterRepository).getByProject(target.id)).toEqual([]);
    expect(await TestBed.inject(InstanceRepository).getByProject(target.id)).toEqual([]);

    // 別プロジェクトのデータは残る
    expect(await TestBed.inject(ProjectRepository).getById(keep.id)).toBeDefined();
    expect(await TestBed.inject(CaseRepository).getByProject(keep.id)).toHaveLength(1);
    expect(await TestBed.inject(MasterRepository).getByProject(keep.id)).toHaveLength(1);
    expect(await TestBed.inject(InstanceRepository).getByProject(keep.id)).toHaveLength(1);
  });

  it('削除前に配下の件数を数えられる', async () => {
    const cases = TestBed.inject(CaseService);
    const masters = TestBed.inject(MasterService);
    const instances = TestBed.inject(InstanceService);

    const project = await projects.create('ゲームA');
    const first = await cases.create(project.id, 'ケース1');
    await cases.create(project.id, 'ケース2');
    const master = await masters.create(project.id, { name: '鉄鉱石' });
    await instances.addToCase(first.id, master.id, 2);

    expect(await projects.countDescendants(project.id)).toEqual({
      cases: 2,
      masters: 1,
      instances: 1,
    });
  });
});
