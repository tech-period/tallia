import { TestBed } from '@angular/core/testing';
import { resetDatabase } from '../db/db.spec-helper';
import { MasterRepository } from '../repositories/master.repository';
import { CaseService } from './case.service';
import { MasterInUseError } from './errors';
import { InstanceService } from './instance.service';
import { MasterService } from './master.service';
import { ProjectService } from './project.service';

describe('MasterService', () => {
  let masters: MasterService;
  let projectId: string;

  beforeEach(async () => {
    await resetDatabase();
    TestBed.configureTestingModule({});
    masters = TestBed.inject(MasterService);
    projectId = (await TestBed.inject(ProjectService).create('ゲームA')).id;
  });

  it('タグは前後の空白を落として重複を除く', async () => {
    const created = await masters.create(projectId, {
      name: '鉄鉱石',
      tags: [' レア ', 'レア', '', '換金用'],
    });

    expect(created.tags).toEqual(['レア', '換金用']);
  });

  it('同一プロジェクト内で同名は登録できない', async () => {
    await masters.create(projectId, { name: '鉄鉱石' });

    await expect(masters.create(projectId, { name: '鉄鉱石' })).rejects.toThrow(
      /既に登録されています/,
    );
  });

  it('別プロジェクトなら同名を登録できる', async () => {
    const other = (await TestBed.inject(ProjectService).create('ゲームB')).id;
    await masters.create(projectId, { name: '鉄鉱石' });

    await expect(masters.create(other, { name: '鉄鉱石' })).resolves.toBeDefined();
  });

  it('使用されていなければ削除できる', async () => {
    const created = await masters.create(projectId, { name: '鉄鉱石' });

    await masters.delete(created.id);

    expect(await TestBed.inject(MasterRepository).getById(created.id)).toBeUndefined();
  });

  it('使用中のマスターは削除を拒否し、使用件数を返す', async () => {
    const cases = TestBed.inject(CaseService);
    const instances = TestBed.inject(InstanceService);
    const master = await masters.create(projectId, { name: '鉄鉱石' });
    const first = await cases.create(projectId, '1章');
    const second = await cases.create(projectId, '2章');
    await instances.addToCase(first.id, master.id, 1);
    await instances.addToCase(second.id, master.id, 1);

    await expect(masters.delete(master.id)).rejects.toBeInstanceOf(MasterInUseError);
    await expect(masters.delete(master.id)).rejects.toMatchObject({ usageCount: 2 });
    // 拒否された場合はレコードが残る
    expect(await TestBed.inject(MasterRepository).getById(master.id)).toBeDefined();
  });

  it('どのケースで使われているかを集計する', async () => {
    const cases = TestBed.inject(CaseService);
    const instances = TestBed.inject(InstanceService);
    const master = await masters.create(projectId, { name: '鉄鉱石' });
    const first = await cases.create(projectId, '1章');
    await instances.addToCase(first.id, master.id, 4);
    await masters.load(projectId);

    expect(masters.usage().get(master.id)).toEqual([{ caseId: first.id, caseName: '1章', qty: 4 }]);
  });

  it('カテゴリとタグの一覧を重複なく返す', async () => {
    await masters.create(projectId, { name: '鉄鉱石', category: '素材', tags: ['レア'] });
    await masters.create(projectId, { name: '銅鉱石', category: '素材', tags: ['レア', '換金用'] });

    expect(masters.categories()).toEqual(['素材']);
    expect(masters.tags()).toEqual(['レア', '換金用']);
  });
});
