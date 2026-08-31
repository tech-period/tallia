import { resetDatabase } from '../db/db.spec-helper';
import { CaseRepository } from './case.repository';
import { makeCase } from './repositories.spec-helper';

describe('CaseRepository', () => {
  let repository: CaseRepository;

  beforeEach(async () => {
    await resetDatabase();
    repository = new CaseRepository();
    await repository.put(makeCase('c1', 'p1', 0));
    await repository.put(makeCase('c2', 'p1', 1));
    await repository.put(makeCase('c3', 'p2', 0));
  });

  it('by-project インデックスでプロジェクト配下だけを取得する', async () => {
    const cases = await repository.getByProject('p1');

    expect(cases.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
  });

  it('プロジェクト配下の件数を数えられる', async () => {
    expect(await repository.countByProject('p1')).toBe(2);
    expect(await repository.countByProject('p2')).toBe(1);
    expect(await repository.countByProject('unknown')).toBe(0);
  });

  it('deleteByProject は他プロジェクトのケースを消さない', async () => {
    await repository.deleteByProject('p1');

    expect(await repository.getByProject('p1')).toEqual([]);
    expect(await repository.getByProject('p2')).toHaveLength(1);
  });

  it('個別に削除できる', async () => {
    await repository.delete('c1');

    expect(await repository.getById('c1')).toBeUndefined();
    expect(await repository.getById('c2')).toBeDefined();
  });
});
