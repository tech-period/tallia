import { TestBed } from '@angular/core/testing';
import { resetDatabase } from '../db/db.spec-helper';
import { MasterImage } from '../db/schema';
import { MasterImageRepository } from './master-image.repository';

function makeImage(masterId: string, projectId: string, bytes: number[]): MasterImage {
  const data = new Uint8Array(bytes).buffer;
  return {
    masterId,
    projectId,
    data,
    type: 'image/webp',
    width: 4,
    height: 3,
    size: data.byteLength,
    updatedAt: '2026-08-31T12:00:00.000Z',
  };
}

describe('MasterImageRepository', () => {
  let repository: MasterImageRepository;

  beforeEach(async () => {
    await resetDatabase();
    TestBed.configureTestingModule({});
    repository = TestBed.inject(MasterImageRepository);
  });

  it('バイナリがそのまま往復する', async () => {
    await repository.put(makeImage('m1', 'p1', [1, 2, 250, 255]));

    const stored = await repository.getByMaster('m1');

    expect(stored?.type).toBe('image/webp');
    expect([...new Uint8Array(stored?.data ?? new ArrayBuffer(0))]).toEqual([1, 2, 250, 255]);
  });

  it('プロジェクト単位で読み込める', async () => {
    await repository.put(makeImage('m1', 'p1', [1]));
    await repository.put(makeImage('m2', 'p1', [2]));
    await repository.put(makeImage('m3', 'p2', [3]));

    const stored = await repository.getByProject('p1');

    expect(stored.map((image) => image.masterId).sort()).toEqual(['m1', 'm2']);
  });

  it('プロジェクト単位の削除は他プロジェクトに影響しない', async () => {
    await repository.put(makeImage('m1', 'p1', [1]));
    await repository.put(makeImage('m3', 'p2', [3]));

    await repository.deleteByProject('p1');

    expect(await repository.getByProject('p1')).toEqual([]);
    expect(await repository.getByProject('p2')).toHaveLength(1);
  });
});
