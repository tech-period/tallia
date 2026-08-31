import { resetDatabase } from '../db/db.spec-helper';
import { MasterRepository } from './master.repository';
import { makeMaster } from './repositories.spec-helper';

describe('MasterRepository', () => {
  let repository: MasterRepository;

  beforeEach(async () => {
    await resetDatabase();
    repository = new MasterRepository();
    await repository.put(makeMaster('m1', 'p1', '鉄鉱石'));
    await repository.put(makeMaster('m2', 'p1', '銅鉱石'));
    await repository.put(makeMaster('m3', 'p2', '鉄鉱石'));
  });

  it('by-project インデックスでプロジェクト配下だけを取得する', async () => {
    const masters = await repository.getByProject('p1');

    expect(masters.map((m) => m.id).sort()).toEqual(['m1', 'm2']);
  });

  it('by-project-name インデックスで同一プロジェクト内の名前を引ける', async () => {
    const found = await repository.findByName('p1', '鉄鉱石');

    expect(found?.id).toBe('m1');
  });

  it('プロジェクトが違えば同名でも別レコードとして扱う', async () => {
    expect((await repository.findByName('p2', '鉄鉱石'))?.id).toBe('m3');
    expect(await repository.findByName('p1', '存在しない')).toBeUndefined();
  });

  it('deleteByProject は他プロジェクトのマスターを消さない', async () => {
    await repository.deleteByProject('p1');

    expect(await repository.getByProject('p1')).toEqual([]);
    expect(await repository.getByProject('p2')).toHaveLength(1);
  });
});
