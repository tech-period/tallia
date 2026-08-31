import { TestBed } from '@angular/core/testing';
import { resetDatabase } from '../db/db.spec-helper';
import { MasterRepository } from '../repositories/master.repository';
import { CaseService } from './case.service';
import { CategoryService } from './category.service';
import { MasterInUseError } from './errors';
import { InstanceService } from './instance.service';
import { MasterService } from './master.service';
import { ProjectService } from './project.service';
import { TagService } from './tag.service';

describe('MasterService', () => {
  let masters: MasterService;
  let projectId: string;

  beforeEach(async () => {
    await resetDatabase();
    TestBed.configureTestingModule({});
    masters = TestBed.inject(MasterService);
    projectId = (await TestBed.inject(ProjectService).create('ゲームA')).id;
  });

  it('タグは重複を除き、マスタに無い ID は落とす', async () => {
    const tags = TestBed.inject(TagService);
    const rare = await tags.create(projectId, 'レア');
    const sellable = await tags.create(projectId, '換金用');

    const created = await masters.create(projectId, {
      name: '鉄鉱石',
      tagIds: [rare.id, rare.id, sellable.id, 'missing'],
    });

    expect(created.tagIds).toEqual([rare.id, sellable.id]);
  });

  it('カテゴリはマスタから選んだものだけを受け付ける', async () => {
    const categories = TestBed.inject(CategoryService);
    const material = await categories.create(projectId, '素材');

    const created = await masters.create(projectId, { name: '鉄鉱石', categoryId: material.id });

    expect(created.categoryId).toBe(material.id);
    await expect(
      masters.create(projectId, { name: '銅鉱石', categoryId: 'missing' }),
    ).rejects.toThrow(/見つかりません/);
  });

  it('別プロジェクトのカテゴリ / タグは参照できない', async () => {
    const other = (await TestBed.inject(ProjectService).create('ゲームB')).id;
    const otherCategory = await TestBed.inject(CategoryService).create(other, '素材');
    const otherTag = await TestBed.inject(TagService).create(other, 'レア');

    await expect(
      masters.create(projectId, { name: '鉄鉱石', categoryId: otherCategory.id }),
    ).rejects.toThrow(/見つかりません/);
    const created = await masters.create(projectId, { name: '鉄鉱石', tagIds: [otherTag.id] });
    expect(created.tagIds).toEqual([]);
  });

  it('カテゴリを空文字で更新すると未設定に戻る', async () => {
    const category = await TestBed.inject(CategoryService).create(projectId, '素材');
    const created = await masters.create(projectId, { name: '鉄鉱石', categoryId: category.id });

    const updated = await masters.update(created.id, { categoryId: '' });

    expect(updated.categoryId).toBeUndefined();
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
});
