import { resetDatabase } from '../db/db.spec-helper';
import { InstanceRepository } from './instance.repository';
import { makeInstance } from './repositories.spec-helper';

describe('InstanceRepository', () => {
  let repository: InstanceRepository;

  beforeEach(async () => {
    await resetDatabase();
    repository = new InstanceRepository();
    await repository.put(makeInstance('i1', 'p1', 'c1', 'm1', 3));
    await repository.put(makeInstance('i2', 'p1', 'c1', 'm2', 5));
    await repository.put(makeInstance('i3', 'p1', 'c2', 'm1', 7));
    await repository.put(makeInstance('i4', 'p2', 'c3', 'm3', 1));
  });

  it('by-case インデックスでケース配下だけを取得する', async () => {
    const instances = await repository.getByCase('c1');

    expect(instances.map((i) => i.id).sort()).toEqual(['i1', 'i2']);
  });

  it('by-master インデックスでマスター参照を取得する', async () => {
    const instances = await repository.getByMaster('m1');

    expect(instances.map((i) => i.id).sort()).toEqual(['i1', 'i3']);
  });

  it('by-project インデックスでプロジェクト配下だけを取得する', async () => {
    expect(await repository.getByProject('p1')).toHaveLength(3);
    expect(await repository.getByProject('p2')).toHaveLength(1);
  });

  it('by-case-master インデックスでケースとマスターの組を引ける', async () => {
    const found = await repository.findByCaseAndMaster('c1', 'm2');

    expect(found?.id).toBe('i2');
    expect(found?.qty).toBe(5);
  });

  it('マスターの使用件数を数えられる', async () => {
    expect(await repository.countByMaster('m1')).toBe(2);
    expect(await repository.countByMaster('m9')).toBe(0);
  });

  it('by-case-master は unique 制約付きで、同じ組の二重登録を拒否する', async () => {
    await expect(repository.put(makeInstance('i5', 'p1', 'c1', 'm1', 1))).rejects.toThrow();
  });

  it('deleteByCase は他ケースのインスタンスを消さない', async () => {
    await repository.deleteByCase('c1');

    expect(await repository.getByCase('c1')).toEqual([]);
    expect(await repository.getByCase('c2')).toHaveLength(1);
  });

  it('deleteByProject は他プロジェクトのインスタンスを消さない', async () => {
    await repository.deleteByProject('p1');

    expect(await repository.getByProject('p1')).toEqual([]);
    expect(await repository.getByProject('p2')).toHaveLength(1);
  });
});
