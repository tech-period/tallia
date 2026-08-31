import { TestBed } from '@angular/core/testing';
import { resetDatabase } from '../db/db.spec-helper';
import { ImagePayload } from '../db/schema';
import { ProjectImageRepository } from '../repositories/project-image.repository';
import { ProjectImageService } from './project-image.service';
import { ProjectService } from './project.service';

function makePayload(bytes: number[]): ImagePayload {
  return { data: new Uint8Array(bytes).buffer, type: 'image/webp', width: 4, height: 3 };
}

describe('ProjectImageService', () => {
  let images: ProjectImageService;
  let projects: ProjectService;

  beforeEach(async () => {
    await resetDatabase();
    // jsdom には Object URL が無いため、識別できるだけのスタブを置く
    let counter = 0;
    URL.createObjectURL = () => `blob:tallia/${(counter += 1)}`;
    URL.revokeObjectURL = () => undefined;

    TestBed.configureTestingModule({});
    images = TestBed.inject(ProjectImageService);
    projects = TestBed.inject(ProjectService);
  });

  it('保存すると表示用 URL が公開され、内容を取り出せる', async () => {
    const project = await projects.create('ゲームA');

    await images.save(project.id, makePayload([1, 2, 3]));

    expect(images.urls().get(project.id)).toMatch(/^blob:/);
    const stored = await images.get(project.id);
    expect([...new Uint8Array(stored?.data ?? new ArrayBuffer(0))]).toEqual([1, 2, 3]);
    expect(stored?.size).toBe(3);
  });

  it('保存し直すと差し替わる', async () => {
    const project = await projects.create('ゲームA');
    await images.save(project.id, makePayload([1]));
    const first = images.urls().get(project.id);

    await images.save(project.id, makePayload([2, 2]));

    expect(images.urls().get(project.id)).not.toBe(first);
    expect((await images.get(project.id))?.size).toBe(2);
  });

  it('削除すると URL もレコードも消える', async () => {
    const project = await projects.create('ゲームA');
    await images.save(project.id, makePayload([1]));

    await images.remove(project.id);

    expect(images.urls().has(project.id)).toBe(false);
    expect(await images.get(project.id)).toBeNull();
  });

  it('プロジェクトを削除すると画像も一緒に消え、他プロジェクトの画像は残る', async () => {
    const target = await projects.create('ゲームA');
    const other = await projects.create('ゲームB');
    await images.save(target.id, makePayload([1]));
    await images.save(other.id, makePayload([2]));

    await projects.delete(target.id);

    const repository = TestBed.inject(ProjectImageRepository);
    expect(await repository.getByProject(target.id)).toBeUndefined();
    expect(await repository.getByProject(other.id)).toBeDefined();
    expect(images.urls().has(target.id)).toBe(false);
    expect(images.urls().has(other.id)).toBe(true);
  });

  it('一覧の読み込みで既存プロジェクトの画像 URL がそろう', async () => {
    const project = await projects.create('ゲームA');
    await TestBed.inject(ProjectImageRepository).put({
      projectId: project.id,
      data: new Uint8Array([9]).buffer,
      type: 'image/png',
      width: 1,
      height: 1,
      size: 1,
      updatedAt: '2026-08-31T12:00:00.000Z',
    });

    await projects.load();

    expect(images.urls().get(project.id)).toMatch(/^blob:/);
  });
});
