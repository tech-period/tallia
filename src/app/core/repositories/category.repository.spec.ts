import { resetDatabase } from '../db/db.spec-helper';
import { CategoryRepository } from './category.repository';
import { TagRepository } from './tag.repository';
import { makeLabel } from './repositories.spec-helper';

describe('CategoryRepository / TagRepository', () => {
  let categories: CategoryRepository;
  let tags: TagRepository;

  beforeEach(async () => {
    await resetDatabase();
    categories = new CategoryRepository();
    tags = new TagRepository();
    await categories.put(makeLabel('c1', 'p1', '素材', 0));
    await categories.put(makeLabel('c2', 'p1', '武器', 1));
    await categories.put(makeLabel('c3', 'p2', '素材', 0));
    await tags.put(makeLabel('t1', 'p1', 'レア', 0));
  });

  it('by-project インデックスでプロジェクト配下だけを取得する', async () => {
    const found = await categories.getByProject('p1');

    expect(found.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
  });

  it('by-project-name インデックスで同一プロジェクト内の名前を引ける', async () => {
    expect((await categories.findByName('p1', '素材'))?.id).toBe('c1');
    expect((await categories.findByName('p2', '素材'))?.id).toBe('c3');
    expect(await categories.findByName('p1', '存在しない')).toBeUndefined();
  });

  it('カテゴリとタグは別ストアで、同名でも干渉しない', async () => {
    await tags.put(makeLabel('t2', 'p1', '素材', 1));

    expect((await categories.findByName('p1', '素材'))?.id).toBe('c1');
    expect((await tags.findByName('p1', '素材'))?.id).toBe('t2');
  });

  it('deleteByProject は他プロジェクトのカテゴリを消さない', async () => {
    await categories.deleteByProject('p1');

    expect(await categories.getByProject('p1')).toEqual([]);
    expect(await categories.getByProject('p2')).toHaveLength(1);
    expect(await tags.getByProject('p1')).toHaveLength(1);
  });

  it('countByProject はプロジェクト配下の件数を返す', async () => {
    expect(await categories.countByProject('p1')).toBe(2);
    expect(await tags.countByProject('p1')).toBe(1);
  });
});
