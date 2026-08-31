import { TestBed } from '@angular/core/testing';
import { resetDatabase } from '../db/db.spec-helper';
import { CategoryService } from './category.service';
import { LabelInUseError } from './errors';
import { MasterService } from './master.service';
import { ProjectService } from './project.service';
import { TagService } from './tag.service';

describe('CategoryService / TagService', () => {
  let categories: CategoryService;
  let tags: TagService;
  let masters: MasterService;
  let projectId: string;

  beforeEach(async () => {
    await resetDatabase();
    TestBed.configureTestingModule({});
    categories = TestBed.inject(CategoryService);
    tags = TestBed.inject(TagService);
    masters = TestBed.inject(MasterService);
    projectId = (await TestBed.inject(ProjectService).create('ゲームA')).id;
  });

  it('追加した順に order が振られる', async () => {
    await categories.create(projectId, '素材');
    await categories.create(projectId, '武器');

    expect(categories.all().map((c) => [c.name, c.order])).toEqual([
      ['素材', 0],
      ['武器', 1],
    ]);
  });

  it('同一プロジェクト内で同名は登録できない', async () => {
    await categories.create(projectId, '素材');

    await expect(categories.create(projectId, '素材')).rejects.toThrow(/既に登録されている/);
  });

  it('別プロジェクトなら同名を登録できる', async () => {
    const other = (await TestBed.inject(ProjectService).create('ゲームB')).id;
    await categories.create(projectId, '素材');

    await expect(categories.create(other, '素材')).resolves.toBeDefined();
  });

  it('名前を変えてもオブジェクトの参照は保たれる', async () => {
    const category = await categories.create(projectId, '素材');
    const master = await masters.create(projectId, { name: '鉄鉱石', categoryId: category.id });

    await categories.update(category.id, '素材（改）');

    expect((await masters.getById(master.id))?.categoryId).toBe(category.id);
    expect(categories.all()[0].name).toBe('素材（改）');
  });

  it('上下に動かすと order を連番で振り直す', async () => {
    await categories.create(projectId, '素材');
    const weapon = await categories.create(projectId, '武器');

    await categories.move(weapon.id, -1);

    expect(categories.all().map((c) => c.name)).toEqual(['武器', '素材']);
    expect(categories.all().map((c) => c.order)).toEqual([0, 1]);
  });

  it('使われていなければ削除できる', async () => {
    const category = await categories.create(projectId, '素材');

    await categories.delete(category.id);

    expect(categories.all()).toEqual([]);
  });

  it('使用中のカテゴリは削除を拒否し、使用件数を返す', async () => {
    const category = await categories.create(projectId, '素材');
    await masters.create(projectId, { name: '鉄鉱石', categoryId: category.id });
    await masters.create(projectId, { name: '銅鉱石', categoryId: category.id });

    await expect(categories.delete(category.id)).rejects.toBeInstanceOf(LabelInUseError);
    await expect(categories.delete(category.id)).rejects.toMatchObject({ usageCount: 2 });
    expect(await categories.getById(category.id)).toBeDefined();
  });

  it('使用中のタグは削除を拒否する', async () => {
    const tag = await tags.create(projectId, 'レア');
    await masters.create(projectId, { name: '鉄鉱石', tagIds: [tag.id] });

    await expect(tags.delete(tag.id)).rejects.toBeInstanceOf(LabelInUseError);
  });

  it('どのオブジェクトで使われているかを集計する', async () => {
    const tag = await tags.create(projectId, 'レア');
    const master = await masters.create(projectId, { name: '鉄鉱石', tagIds: [tag.id] });
    await masters.create(projectId, { name: '銅鉱石' });
    await tags.load(projectId);

    expect(tags.usage().get(tag.id)).toEqual([{ masterId: master.id, masterName: '鉄鉱石' }]);
  });

  it('カテゴリとタグは互いの使用状況に影響しない', async () => {
    const category = await categories.create(projectId, '素材');
    const tag = await tags.create(projectId, '素材');
    await masters.create(projectId, { name: '鉄鉱石', categoryId: category.id });
    await tags.load(projectId);

    await expect(tags.delete(tag.id)).resolves.toBeUndefined();
  });
});
