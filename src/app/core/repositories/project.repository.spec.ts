import { resetDatabase } from '../db/db.spec-helper';
import { ProjectRepository } from './project.repository';
import { makeProject } from './repositories.spec-helper';

describe('ProjectRepository', () => {
  let repository: ProjectRepository;

  beforeEach(async () => {
    await resetDatabase();
    repository = new ProjectRepository();
  });

  it('保存したプロジェクトを ID で取得できる', async () => {
    await repository.put(makeProject('p1', 'ゲームA'));

    const found = await repository.getById('p1');

    expect(found?.name).toBe('ゲームA');
  });

  it('存在しない ID には undefined を返す', async () => {
    expect(await repository.getById('missing')).toBeUndefined();
  });

  it('全件を取得できる', async () => {
    await repository.put(makeProject('p1'));
    await repository.put(makeProject('p2'));

    const all = await repository.getAll();

    expect(all.map((p) => p.id).sort()).toEqual(['p1', 'p2']);
  });

  it('同じ ID で put すると上書きされる', async () => {
    await repository.put(makeProject('p1', '旧名'));
    await repository.put(makeProject('p1', '新名'));

    expect(await repository.getAll()).toHaveLength(1);
    expect((await repository.getById('p1'))?.name).toBe('新名');
  });

  it('削除できる', async () => {
    await repository.put(makeProject('p1'));

    await repository.delete('p1');

    expect(await repository.getById('p1')).toBeUndefined();
  });

  it('clear で全件消える', async () => {
    await repository.put(makeProject('p1'));
    await repository.put(makeProject('p2'));

    await repository.clear();

    expect(await repository.getAll()).toEqual([]);
  });
});
