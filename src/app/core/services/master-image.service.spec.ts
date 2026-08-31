import { TestBed } from '@angular/core/testing';
import { resetDatabase } from '../db/db.spec-helper';
import { ImagePayload } from '../db/schema';
import { MasterImageRepository } from '../repositories/master-image.repository';
import { InstanceService } from './instance.service';
import { CaseService } from './case.service';
import { MasterImageService } from './master-image.service';
import { MasterService } from './master.service';
import { ProjectService } from './project.service';

function makePayload(bytes: number[]): ImagePayload {
  return { data: new Uint8Array(bytes).buffer, type: 'image/webp', width: 4, height: 3 };
}

describe('MasterImageService', () => {
  let images: MasterImageService;
  let masters: MasterService;
  let projects: ProjectService;

  beforeEach(async () => {
    await resetDatabase();
    // jsdom には Object URL が無いため、識別できるだけのスタブを置く
    let counter = 0;
    URL.createObjectURL = () => `blob:tallia/${(counter += 1)}`;
    URL.revokeObjectURL = () => undefined;

    TestBed.configureTestingModule({});
    images = TestBed.inject(MasterImageService);
    masters = TestBed.inject(MasterService);
    projects = TestBed.inject(ProjectService);
  });

  it('保存すると表示用 URL が公開され、内容を取り出せる', async () => {
    const project = await projects.create('ゲームA');
    const master = await masters.create(project.id, { name: '鉄鉱石' });

    await images.save(master.id, project.id, makePayload([1, 2, 3]));

    expect(images.urls().get(master.id)).toMatch(/^blob:/);
    const stored = await images.get(master.id);
    expect([...new Uint8Array(stored?.data ?? new ArrayBuffer(0))]).toEqual([1, 2, 3]);
    expect(stored?.projectId).toBe(project.id);
  });

  it('表示中プロジェクト分の URL だけを保持する', async () => {
    const projectA = await projects.create('ゲームA');
    const projectB = await projects.create('ゲームB');
    const masterA = await masters.create(projectA.id, { name: '鉄鉱石' });
    const masterB = await masters.create(projectB.id, { name: '薬草' });
    await images.save(masterA.id, projectA.id, makePayload([1]));
    await images.save(masterB.id, projectB.id, makePayload([2]));

    await images.loadByProject(projectA.id);

    expect(images.urls().has(masterA.id)).toBe(true);
    expect(images.urls().has(masterB.id)).toBe(false);
  });

  it('オブジェクトを削除すると画像も消える', async () => {
    const project = await projects.create('ゲームA');
    const master = await masters.create(project.id, { name: '鉄鉱石' });
    await images.save(master.id, project.id, makePayload([1]));

    await masters.delete(master.id);

    expect(await TestBed.inject(MasterImageRepository).getByMaster(master.id)).toBeUndefined();
    expect(images.urls().has(master.id)).toBe(false);
  });

  it('使用中で削除できないオブジェクトの画像は残る', async () => {
    const project = await projects.create('ゲームA');
    const master = await masters.create(project.id, { name: '鉄鉱石' });
    const target = await TestBed.inject(CaseService).create(project.id, '1章');
    await images.save(master.id, project.id, makePayload([1]));
    await TestBed.inject(InstanceService).addToCase(target.id, master.id, 2);

    await expect(masters.delete(master.id)).rejects.toThrow();

    expect(await TestBed.inject(MasterImageRepository).getByMaster(master.id)).toBeDefined();
  });

  it('プロジェクトを削除すると配下オブジェクトの画像も消え、他プロジェクトの画像は残る', async () => {
    const target = await projects.create('ゲームA');
    const other = await projects.create('ゲームB');
    const masterA = await masters.create(target.id, { name: '鉄鉱石' });
    const masterB = await masters.create(other.id, { name: '薬草' });
    await images.save(masterA.id, target.id, makePayload([1]));
    await images.save(masterB.id, other.id, makePayload([2]));

    await projects.delete(target.id);

    const repository = TestBed.inject(MasterImageRepository);
    expect(await repository.getByMaster(masterA.id)).toBeUndefined();
    expect(await repository.getByMaster(masterB.id)).toBeDefined();
  });
});
