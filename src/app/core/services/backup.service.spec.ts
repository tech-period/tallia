import { TestBed } from '@angular/core/testing';
import { resetDatabase } from '../db/db.spec-helper';
import { BACKUP_FORMAT, BACKUP_VERSION } from '../db/schema';
import { CaseRepository } from '../repositories/case.repository';
import { CategoryRepository } from '../repositories/category.repository';
import { TagRepository } from '../repositories/tag.repository';
import { MasterImageRepository } from '../repositories/master-image.repository';
import { ProjectImageRepository } from '../repositories/project-image.repository';
import { InstanceRepository } from '../repositories/instance.repository';
import { MasterRepository } from '../repositories/master.repository';
import { ProjectRepository } from '../repositories/project.repository';
import { BackupService } from './backup.service';
import { CaseService } from './case.service';
import { CategoryService } from './category.service';
import { TagService } from './tag.service';
import { InstanceService } from './instance.service';
import { MasterService } from './master.service';
import { MasterImageService } from './master-image.service';
import { ProjectImageService } from './project-image.service';
import { ProjectService } from './project.service';

describe('BackupService', () => {
  let backup: BackupService;

  beforeEach(async () => {
    await resetDatabase();
    TestBed.configureTestingModule({});
    backup = TestBed.inject(BackupService);
  });

  async function seed(projectName: string): Promise<string> {
    const project = await TestBed.inject(ProjectService).create(projectName);
    const target = await TestBed.inject(CaseService).create(project.id, '1章');
    const category = await TestBed.inject(CategoryService).create(project.id, '素材');
    const tag = await TestBed.inject(TagService).create(project.id, 'レア');
    const master = await TestBed.inject(MasterService).create(project.id, {
      name: '鉄鉱石',
      categoryId: category.id,
      tagIds: [tag.id],
    });
    await TestBed.inject(InstanceService).addToCase(target.id, master.id, 3);
    return project.id;
  }

  it('全プロジェクトを書き出す', async () => {
    await seed('ゲームA');
    await seed('ゲームB');

    const file = await backup.exportAll();

    expect(file.format).toBe(BACKUP_FORMAT);
    expect(file.version).toBe(BACKUP_VERSION);
    expect(file.projects).toHaveLength(2);
    expect(file.cases).toHaveLength(2);
    expect(file.masters).toHaveLength(2);
    expect(file.instances).toHaveLength(2);
    expect(file.categories).toHaveLength(2);
    expect(file.tags).toHaveLength(2);
  });

  it('プロジェクト単位ではそのプロジェクトのレコードだけを含む', async () => {
    const first = await seed('ゲームA');
    await seed('ゲームB');

    const file = await backup.exportProject(first);

    expect(file.projects.map((p) => p.id)).toEqual([first]);
    expect(file.cases.every((c) => c.projectId === first)).toBe(true);
    expect(file.masters.every((m) => m.projectId === first)).toBe(true);
    expect(file.instances.every((i) => i.projectId === first)).toBe(true);
    expect(file.categories?.every((c) => c.projectId === first)).toBe(true);
    expect(file.tags?.every((t) => t.projectId === first)).toBe(true);
  });

  it('ファイル名は日時付きで、プロジェクト名も入れられる', () => {
    expect(backup.fileName()).toMatch(/^tallia-\d{8}-\d{6}\.json$/);
    expect(backup.fileName('ゲーム A')).toMatch(/^tallia-ゲーム_A-\d{8}-\d{6}\.json$/);
  });

  it('format が違うファイルは拒否する', () => {
    const text = JSON.stringify({ format: 'other', version: 1 });

    expect(() => backup.parse(text)).toThrow(/バックアップではありません/);
  });

  it('version が違うファイルは拒否する', () => {
    const text = JSON.stringify({ format: BACKUP_FORMAT, version: 99 });

    expect(() => backup.parse(text)).toThrow(/対応していないバックアップ形式/);
  });

  it('JSON として壊れているファイルは拒否する', () => {
    expect(() => backup.parse('{')).toThrow(/JSON として読み取れませんでした/);
  });

  it('追加モードは ID を採番し直し、外部キーも一貫して差し替える', async () => {
    const original = await seed('ゲームA');
    const file = await backup.exportProject(original);

    const result = await backup.import(file, 'append');

    expect(result).toEqual({
      projects: 1,
      cases: 1,
      categories: 1,
      tags: 1,
      masters: 1,
      instances: 1,
      images: 0,
      masterImages: 0,
    });

    const projects = await TestBed.inject(ProjectRepository).getAll();
    expect(projects).toHaveLength(2);
    const added = projects.find((p) => p.id !== original);
    expect(added).toBeDefined();

    const addedCases = await TestBed.inject(CaseRepository).getByProject(added!.id);
    const addedMasters = await TestBed.inject(MasterRepository).getByProject(added!.id);
    const addedInstances = await TestBed.inject(InstanceRepository).getByProject(added!.id);
    expect(addedCases).toHaveLength(1);
    expect(addedMasters).toHaveLength(1);
    expect(addedInstances).toHaveLength(1);

    // 参照が新しい ID を指していること
    expect(addedInstances[0].caseId).toBe(addedCases[0].id);
    expect(addedInstances[0].masterId).toBe(addedMasters[0].id);
    expect(addedInstances[0].qty).toBe(3);
    // 元のデータは変更されない
    expect(await TestBed.inject(InstanceRepository).getByProject(original)).toHaveLength(1);
  });

  it('追加モードではカテゴリ / タグも採番し直し、オブジェクトの参照が追随する', async () => {
    const original = await seed('ゲームA');
    const file = await backup.exportProject(original);

    await backup.import(file, 'append');

    const projects = await TestBed.inject(ProjectRepository).getAll();
    const added = projects.find((p) => p.id !== original);
    const addedCategories = await TestBed.inject(CategoryRepository).getByProject(added!.id);
    const addedTags = await TestBed.inject(TagRepository).getByProject(added!.id);
    const addedMasters = await TestBed.inject(MasterRepository).getByProject(added!.id);

    expect(addedCategories).toHaveLength(1);
    expect(addedTags).toHaveLength(1);
    // 新しい ID を指し、元のプロジェクトの分類は参照していない
    expect(addedMasters[0].categoryId).toBe(addedCategories[0].id);
    expect(addedMasters[0].tagIds).toEqual([addedTags[0].id]);
    expect(await TestBed.inject(CategoryRepository).getByProject(original)).toHaveLength(1);
  });

  it('version 3 のファイルは文字列のカテゴリ / タグをレコードに振り替えて取り込む', async () => {
    const legacy = {
      format: BACKUP_FORMAT,
      version: 3,
      exportedAt: '2026-08-31T12:00:00.000Z',
      projects: [
        {
          id: 'p1',
          name: 'ゲームA',
          createdAt: '2026-08-31T12:00:00.000Z',
          updatedAt: '2026-08-31T12:00:00.000Z',
        },
      ],
      cases: [],
      masters: [
        {
          id: 'm1',
          projectId: 'p1',
          name: '鉄鉱石',
          category: '素材',
          tags: ['レア', '換金用'],
          createdAt: '2026-08-31T12:00:00.000Z',
          updatedAt: '2026-08-31T12:00:00.000Z',
        },
        {
          id: 'm2',
          projectId: 'p1',
          name: '銅鉱石',
          category: '素材',
          tags: ['換金用'],
          createdAt: '2026-08-31T12:00:00.000Z',
          updatedAt: '2026-08-31T12:00:00.000Z',
        },
      ],
      instances: [],
    };

    const parsed = backup.parse(JSON.stringify(legacy));
    const result = await backup.import(parsed, 'replace');

    expect(result.categories).toBe(1);
    expect(result.tags).toBe(2);
    const categories = await TestBed.inject(CategoryRepository).getByProject('p1');
    const tags = await TestBed.inject(TagRepository).getByProject('p1');
    const masters = await TestBed.inject(MasterRepository).getByProject('p1');
    expect(categories.map((c) => c.name)).toEqual(['素材']);
    expect(tags.map((t) => t.name).sort()).toEqual(['レア', '換金用']);
    // 同じ名前は 1 レコードにまとまり、両方のオブジェクトが同じ ID を指す
    expect(masters.map((m) => m.categoryId)).toEqual([categories[0].id, categories[0].id]);
    expect(masters.find((m) => m.id === 'm2')?.tagIds).toHaveLength(1);
  });

  it('置換モードは既存データを消してからファイルの内容を投入する', async () => {
    const first = await seed('ゲームA');
    const file = await backup.exportProject(first);
    await seed('ゲームB');

    await backup.import(file, 'replace');

    const projects = await TestBed.inject(ProjectRepository).getAll();
    expect(projects.map((p) => p.id)).toEqual([first]);
    expect(await TestBed.inject(InstanceRepository).getByProject(first)).toHaveLength(1);
  });

  it('全データ削除でどのストアも空になる', async () => {
    const projectId = await seed('ゲームA');

    await backup.deleteEverything();

    expect(await TestBed.inject(ProjectRepository).getAll()).toEqual([]);
    expect(await TestBed.inject(CaseRepository).getByProject(projectId)).toEqual([]);
    expect(await TestBed.inject(MasterRepository).getByProject(projectId)).toEqual([]);
    expect(await TestBed.inject(InstanceRepository).getByProject(projectId)).toEqual([]);
    expect(await TestBed.inject(CategoryRepository).getByProject(projectId)).toEqual([]);
    expect(await TestBed.inject(TagRepository).getByProject(projectId)).toEqual([]);
  });

  it('書き出した JSON は Date ではなく ISO 文字列を保持する', async () => {
    await seed('ゲームA');

    const file = await backup.exportAll();
    const roundTripped = backup.parse(JSON.stringify(file));

    expect(typeof roundTripped.projects[0].createdAt).toBe('string');
    expect(roundTripped.projects[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('BackupService（画像）', () => {
  let backup: BackupService;
  let images: ProjectImageService;

  beforeEach(async () => {
    await resetDatabase();
    // jsdom には Object URL が無いため、識別できるだけのスタブを置く
    let counter = 0;
    URL.createObjectURL = () => `blob:tallia/${(counter += 1)}`;
    URL.revokeObjectURL = () => undefined;

    TestBed.configureTestingModule({});
    backup = TestBed.inject(BackupService);
    images = TestBed.inject(ProjectImageService);
  });

  async function seedWithImage(name: string, bytes: number[]): Promise<string> {
    const project = await TestBed.inject(ProjectService).create(name);
    await images.save(project.id, {
      data: new Uint8Array(bytes).buffer,
      type: 'image/webp',
      width: 4,
      height: 3,
    });
    return project.id;
  }

  it('画像を base64 で書き出す', async () => {
    const projectId = await seedWithImage('ゲームA', [1, 2, 250]);

    const file = await backup.exportAll();

    expect(file.images).toHaveLength(1);
    expect(file.images?.[0].projectId).toBe(projectId);
    expect(file.images?.[0].type).toBe('image/webp');
    expect(file.images?.[0].data).toBe(btoa(String.fromCharCode(1, 2, 250)));
  });

  it('プロジェクト単位の書き出しにはそのプロジェクトの画像だけが入る', async () => {
    const projectId = await seedWithImage('ゲームA', [1]);
    await seedWithImage('ゲームB', [2]);

    const file = await backup.exportProject(projectId);

    expect(file.images).toHaveLength(1);
    expect(file.images?.[0].projectId).toBe(projectId);
  });

  it('追加モードでは画像の projectId も採番し直され、内容は保たれる', async () => {
    await seedWithImage('ゲームA', [1, 2, 3]);
    const file = await backup.exportAll();
    await resetDatabase();

    await backup.import(file, 'append');

    const stored = await TestBed.inject(ProjectImageRepository).getAll();
    const projects = await TestBed.inject(ProjectRepository).getAll();
    expect(stored).toHaveLength(1);
    expect(stored[0].projectId).toBe(projects[0].id);
    expect([...new Uint8Array(stored[0].data)]).toEqual([1, 2, 3]);
  });

  it('置換モードでは既存の画像を消してから取り込む', async () => {
    await seedWithImage('ゲームA', [1]);
    const file = await backup.exportAll();
    await resetDatabase();
    await seedWithImage('ゲームB', [9, 9, 9]);

    await backup.import(file, 'replace');

    const stored = await TestBed.inject(ProjectImageRepository).getAll();
    expect(stored).toHaveLength(1);
    expect([...new Uint8Array(stored[0].data)]).toEqual([1]);
  });

  it('画像を持たない旧形式（version 1）も読み込める', async () => {
    const file = backup.parse(
      JSON.stringify({
        format: BACKUP_FORMAT,
        version: 1,
        exportedAt: '2026-08-31T12:00:00.000Z',
        projects: [],
        cases: [],
        masters: [],
        instances: [],
      }),
    );

    expect(file.version).toBe(1);
    expect(file.images).toEqual([]);
    await expect(backup.import(file, 'append')).resolves.toMatchObject({ images: 0 });
  });

  it('全データ削除で画像も消える', async () => {
    await seedWithImage('ゲームA', [1]);

    await backup.deleteEverything();

    expect(await TestBed.inject(ProjectImageRepository).getAll()).toEqual([]);
    expect(images.urls().size).toBe(0);
  });
});

describe('BackupService（オブジェクトの画像）', () => {
  let backup: BackupService;
  let masterImages: MasterImageService;

  beforeEach(async () => {
    await resetDatabase();
    // jsdom には Object URL が無いため、識別できるだけのスタブを置く
    let counter = 0;
    URL.createObjectURL = () => `blob:tallia/${(counter += 1)}`;
    URL.revokeObjectURL = () => undefined;

    TestBed.configureTestingModule({});
    backup = TestBed.inject(BackupService);
    masterImages = TestBed.inject(MasterImageService);
  });

  async function seedWithMasterImage(
    projectName: string,
    bytes: number[],
  ): Promise<{ projectId: string; masterId: string }> {
    const project = await TestBed.inject(ProjectService).create(projectName);
    const master = await TestBed.inject(MasterService).create(project.id, { name: '鉄鉱石' });
    await masterImages.save(master.id, project.id, {
      data: new Uint8Array(bytes).buffer,
      type: 'image/webp',
      width: 4,
      height: 3,
    });
    return { projectId: project.id, masterId: master.id };
  }

  it('オブジェクトの画像を base64 で書き出す', async () => {
    const { projectId, masterId } = await seedWithMasterImage('ゲームA', [1, 2, 250]);

    const file = await backup.exportAll();

    expect(file.masterImages).toHaveLength(1);
    expect(file.masterImages?.[0].masterId).toBe(masterId);
    expect(file.masterImages?.[0].projectId).toBe(projectId);
    expect(file.masterImages?.[0].data).toBe(btoa(String.fromCharCode(1, 2, 250)));
  });

  it('プロジェクト単位の書き出しにはそのプロジェクトの画像だけが入る', async () => {
    const { projectId } = await seedWithMasterImage('ゲームA', [1]);
    await seedWithMasterImage('ゲームB', [2]);

    const file = await backup.exportProject(projectId);

    expect(file.masterImages).toHaveLength(1);
    expect(file.masterImages?.[0].projectId).toBe(projectId);
  });

  it('追加モードでは masterId / projectId とも採番し直され、内容は保たれる', async () => {
    await seedWithMasterImage('ゲームA', [1, 2, 3]);
    const file = await backup.exportAll();
    await resetDatabase();

    await backup.import(file, 'append');

    const stored = await TestBed.inject(MasterImageRepository).getAll();
    const masters = await TestBed.inject(MasterRepository).getByProject(
      (await TestBed.inject(ProjectRepository).getAll())[0].id,
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].masterId).toBe(masters[0].id);
    expect(stored[0].projectId).toBe(masters[0].projectId);
    expect([...new Uint8Array(stored[0].data)]).toEqual([1, 2, 3]);
  });

  it('置換モードでは既存のオブジェクト画像を消してから取り込む', async () => {
    await seedWithMasterImage('ゲームA', [1]);
    const file = await backup.exportAll();
    await resetDatabase();
    await seedWithMasterImage('ゲームB', [9, 9, 9]);

    await backup.import(file, 'replace');

    const stored = await TestBed.inject(MasterImageRepository).getAll();
    expect(stored).toHaveLength(1);
    expect([...new Uint8Array(stored[0].data)]).toEqual([1]);
  });

  it('プロジェクト画像だけを持つ旧形式（version 2）も読み込める', async () => {
    const file = backup.parse(
      JSON.stringify({
        format: BACKUP_FORMAT,
        version: 2,
        exportedAt: '2026-08-31T12:00:00.000Z',
        projects: [],
        cases: [],
        masters: [],
        instances: [],
        images: [],
      }),
    );

    expect(file.version).toBe(2);
    expect(file.masterImages).toEqual([]);
    await expect(backup.import(file, 'append')).resolves.toMatchObject({ masterImages: 0 });
  });

  it('全データ削除でオブジェクトの画像も消える', async () => {
    await seedWithMasterImage('ゲームA', [1]);

    await backup.deleteEverything();

    expect(await TestBed.inject(MasterImageRepository).getAll()).toEqual([]);
    expect(masterImages.urls().size).toBe(0);
  });
});
