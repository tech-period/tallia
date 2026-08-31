import { TestBed } from '@angular/core/testing';
import { resetDatabase } from '../db/db.spec-helper';
import { ProjectImage } from '../db/schema';
import { ProjectImageRepository } from './project-image.repository';

function makeImage(projectId: string, bytes: number[]): ProjectImage {
  const data = new Uint8Array(bytes).buffer;
  return {
    projectId,
    data,
    type: 'image/webp',
    width: 4,
    height: 3,
    size: data.byteLength,
    updatedAt: '2026-08-31T12:00:00.000Z',
  };
}

describe('ProjectImageRepository', () => {
  let repository: ProjectImageRepository;

  beforeEach(async () => {
    await resetDatabase();
    TestBed.configureTestingModule({});
    repository = TestBed.inject(ProjectImageRepository);
  });

  it('バイナリがそのまま往復する', async () => {
    await repository.put(makeImage('p1', [1, 2, 250, 255]));

    const stored = await repository.getByProject('p1');

    expect(stored?.type).toBe('image/webp');
    expect([...new Uint8Array(stored?.data ?? new ArrayBuffer(0))]).toEqual([1, 2, 250, 255]);
    expect(stored?.size).toBe(4);
  });

  it('プロジェクトごとに 1 枚だけ保持し、保存し直すと置き換わる', async () => {
    await repository.put(makeImage('p1', [1]));
    await repository.put(makeImage('p1', [2, 3]));

    expect(await repository.getAll()).toHaveLength(1);
    expect((await repository.getByProject('p1'))?.size).toBe(2);
  });

  it('削除しても他プロジェクトの画像は残る', async () => {
    await repository.put(makeImage('p1', [1]));
    await repository.put(makeImage('p2', [2]));

    await repository.deleteByProject('p1');

    expect(await repository.getByProject('p1')).toBeUndefined();
    expect(await repository.getByProject('p2')).toBeDefined();
  });
});
