import { TestBed } from '@angular/core/testing';
import { resetDatabase } from '../db/db.spec-helper';
import { MASTER_FILE_FORMAT, MASTER_FILE_VERSION, MasterFile } from '../db/schema';
import { CategoryRepository } from '../repositories/category.repository';
import { MasterImageRepository } from '../repositories/master-image.repository';
import { MasterRepository } from '../repositories/master.repository';
import { TagRepository } from '../repositories/tag.repository';
import { bytesToBase64 } from '../../shared/utils/image';
import { CategoryService } from './category.service';
import { InvalidMasterFileError, NotFoundError } from './errors';
import { MasterImageService } from './master-image.service';
import { MasterService } from './master.service';
import { MasterTransferService } from './master-transfer.service';
import { ProjectService } from './project.service';
import { TagService } from './tag.service';

describe('MasterTransferService', () => {
  let transfer: MasterTransferService;
  let projects: ProjectService;
  let masters: MasterService;
  let categories: CategoryService;
  let tags: TagService;
  let images: MasterImageService;

  beforeEach(async () => {
    await resetDatabase();
    TestBed.configureTestingModule({});
    transfer = TestBed.inject(MasterTransferService);
    projects = TestBed.inject(ProjectService);
    masters = TestBed.inject(MasterService);
    categories = TestBed.inject(CategoryService);
    tags = TestBed.inject(TagService);
    images = TestBed.inject(MasterImageService);
  });

  /** 1×1 の PNG 相当。中身は問わないので固定のバイト列でよい */
  function payload(byte = 1) {
    return {
      data: new Uint8Array([byte, 2, 3, 4]).buffer,
      type: 'image/webp',
      width: 8,
      height: 8,
    };
  }

  /** カテゴリ 2 / タグ 2 / オブジェクト 2（うち 1 件は画像つき）のプロジェクトを作る */
  async function seed(projectName: string): Promise<string> {
    const project = await projects.create(projectName);
    const material = await categories.create(project.id, '素材');
    await categories.create(project.id, '武器');
    const rare = await tags.create(project.id, 'レア');
    await tags.create(project.id, '換金用');
    const iron = await masters.create(project.id, {
      name: '鉄鉱石',
      categoryId: material.id,
      tagIds: [rare.id],
      note: '洞窟で拾える',
    });
    await masters.create(project.id, { name: '薬草' });
    await images.save(iron.id, project.id, payload());
    return project.id;
  }

  describe('エクスポート', () => {
    it('カテゴリ・タグを名前で、画像を base64 で書き出す', async () => {
      const projectId = await seed('ゲームA');

      const file = await transfer.exportProject(projectId);

      expect(file.format).toBe(MASTER_FILE_FORMAT);
      expect(file.version).toBe(MASTER_FILE_VERSION);
      expect(file.source.projectName).toBe('ゲームA');
      // 参照されていない「武器」「換金用」も order 順で載る
      expect(file.categories).toEqual(['素材', '武器']);
      expect(file.tags).toEqual(['レア', '換金用']);
      // 名前順（日本語の読み順）で固定される
      expect(file.masters.map((m) => m.name)).toEqual(['鉄鉱石', '薬草']);

      const iron = file.masters.find((m) => m.name === '鉄鉱石');
      expect(iron).toEqual({
        name: '鉄鉱石',
        category: '素材',
        tags: ['レア'],
        note: '洞窟で拾える',
        image: { data: bytesToBase64(payload().data), type: 'image/webp', width: 8, height: 8 },
      });
    });

    it('ID を一切含めない', async () => {
      const projectId = await seed('ゲームA');

      const file = await transfer.exportProject(projectId);

      expect(JSON.stringify(file)).not.toContain(projectId);
    });

    it('存在しないプロジェクトは NotFoundError', async () => {
      await expect(transfer.exportProject('missing')).rejects.toThrow(NotFoundError);
    });

    it('ファイル名は .tallia 拡張子になる', () => {
      expect(transfer.fileName('ゲーム A')).toMatch(
        /^tallia-masters-ゲーム_A-\d{8}-\d{6}\.tallia$/,
      );
    });
  });

  describe('parse', () => {
    function serialize(overrides: Partial<MasterFile>): string {
      return JSON.stringify({
        format: MASTER_FILE_FORMAT,
        version: MASTER_FILE_VERSION,
        exportedAt: '2026-08-31T12:00:00.000Z',
        source: { projectName: 'ゲームA' },
        categories: [],
        tags: [],
        masters: [{ name: '鉄鉱石', tags: [] }],
        ...overrides,
      });
    }

    it('JSON として壊れていれば InvalidMasterFileError', () => {
      expect(() => transfer.parse('{')).toThrow(InvalidMasterFileError);
    });

    it('format が違えば取り込まない', () => {
      expect(() => transfer.parse(serialize({ format: 'tallia-backup' as never }))).toThrow(
        /移し替え用ではありません/,
      );
    });

    it('対応していない version は取り込まない', () => {
      expect(() => transfer.parse(serialize({ version: 99 }))).toThrow(/対応していない形式/);
    });

    it('バックアップファイルは取り込めない', () => {
      const backup = JSON.stringify({ format: 'tallia-backup', version: 4, masters: [] });

      expect(() => transfer.parse(backup)).toThrow(InvalidMasterFileError);
    });

    it('名前が空の行と、ファイル内で重複した名前の 2 件目以降を落とす', () => {
      const file = transfer.parse(
        serialize({
          masters: [
            { name: '鉄鉱石', tags: [] },
            { name: '  ', tags: [] },
            { name: '鉄鉱石', tags: ['あと勝ちしない'] },
            { name: '薬草', tags: [] },
          ],
        }),
      );

      expect(file.masters.map((m) => m.name)).toEqual(['鉄鉱石', '薬草']);
      expect(file.masters[0].tags).toEqual([]);
    });

    it('取り込める行が 1 件も無ければエラー', () => {
      expect(() => transfer.parse(serialize({ masters: [{ name: '' }] as never }))).toThrow(
        /1 件もありません/,
      );
    });
  });

  describe('インポート', () => {
    /** 書き出したファイルを、まっさらな別プロジェクトへ取り込む */
    async function transferTo(
      targetName: string,
      file: MasterFile,
      mode: 'skip' | 'overwrite' = 'skip',
    ): Promise<string> {
      const target = await projects.create(targetName);
      await transfer.import(target.id, file, mode);
      return target.id;
    }

    it('カテゴリ・タグ・画像ごと別プロジェクトへ移せる', async () => {
      const sourceId = await seed('ゲームA');
      const file = await transfer.exportProject(sourceId);

      const targetId = await transferTo('ゲームB', file);

      await masters.load(targetId);
      await categories.load(targetId);
      await tags.load(targetId);
      const iron = masters.all().find((m) => m.name === '鉄鉱石');
      expect([...masters.all()].map((m) => m.name).sort()).toEqual(['薬草', '鉄鉱石'].sort());
      expect(categories.all().map((c) => c.name)).toEqual(['素材', '武器']);
      expect(tags.all().map((t) => t.name)).toEqual(['レア', '換金用']);
      expect(categories.all().find((c) => c.id === iron?.categoryId)?.name).toBe('素材');
      expect(await images.get(iron!.id)).toMatchObject({ type: 'image/webp', size: 4 });
    });

    it('移し替え先の ID は新しく採番される', async () => {
      const sourceId = await seed('ゲームA');
      await masters.load(sourceId);
      const sourceIds = masters.all().map((m) => m.id);
      const file = await transfer.exportProject(sourceId);

      const targetId = await transferTo('ゲームB', file);

      await masters.load(targetId);
      for (const master of masters.all()) {
        expect(sourceIds).not.toContain(master.id);
        expect(master.projectId).toBe(targetId);
      }
    });

    it('元のプロジェクトは変化しない', async () => {
      const sourceId = await seed('ゲームA');
      const file = await transfer.exportProject(sourceId);

      await transferTo('ゲームB', file);

      await masters.load(sourceId);
      expect(masters.all()).toHaveLength(2);
      expect(await TestBed.inject(MasterRepository).countByProject(sourceId)).toBe(2);
    });

    it('skip は同名のオブジェクトを飛ばす', async () => {
      const sourceId = await seed('ゲームA');
      const file = await transfer.exportProject(sourceId);
      const target = await projects.create('ゲームB');
      await masters.create(target.id, { name: '鉄鉱石', note: '取り込み先のメモ' });

      const result = await transfer.import(target.id, file, 'skip');

      expect(result).toMatchObject({ added: 1, updated: 0, skipped: 1 });
      await masters.load(target.id);
      expect(masters.all().find((m) => m.name === '鉄鉱石')?.note).toBe('取り込み先のメモ');
    });

    it('overwrite は同名のオブジェクトをファイルの内容で置き換える', async () => {
      const sourceId = await seed('ゲームA');
      const file = await transfer.exportProject(sourceId);
      const target = await projects.create('ゲームB');
      const existing = await masters.create(target.id, { name: '鉄鉱石', note: '古いメモ' });

      const result = await transfer.import(target.id, file, 'overwrite');

      expect(result).toMatchObject({ added: 1, updated: 1, skipped: 0, images: 1 });
      await masters.load(target.id);
      const iron = masters.all().find((m) => m.name === '鉄鉱石');
      // ID は保たれ、中身だけが差し替わる
      expect(iron?.id).toBe(existing.id);
      expect(iron?.note).toBe('洞窟で拾える');
      expect(await images.get(existing.id)).not.toBeNull();
    });

    it('overwrite でファイルに画像が無ければ、取り込み先の画像も消す', async () => {
      const source = await projects.create('ゲームA');
      await masters.create(source.id, { name: '鉄鉱石' });
      const file = await transfer.exportProject(source.id);
      const target = await projects.create('ゲームB');
      const existing = await masters.create(target.id, { name: '鉄鉱石' });
      await images.save(existing.id, target.id, payload(9));

      await transfer.import(target.id, file, 'overwrite');

      expect(await images.get(existing.id)).toBeNull();
    });

    it('同名のカテゴリ・タグは作り直さず、既存のものを指す', async () => {
      const sourceId = await seed('ゲームA');
      const file = await transfer.exportProject(sourceId);
      const target = await projects.create('ゲームB');
      const existing = await categories.create(target.id, '素材');

      const result = await transfer.import(target.id, file, 'skip');

      // 「素材」は既にあるので、新規に作られるのは「武器」だけ
      expect(result.categories).toBe(1);
      await masters.load(target.id);
      expect(masters.all().find((m) => m.name === '鉄鉱石')?.categoryId).toBe(existing.id);
    });

    it('新しく作る分類の order は取り込み先の末尾から続ける', async () => {
      const sourceId = await seed('ゲームA');
      const file = await transfer.exportProject(sourceId);
      const target = await projects.create('ゲームB');
      await categories.create(target.id, '道具');

      await transfer.import(target.id, file, 'skip');

      await categories.load(target.id);
      expect(categories.all().map((c) => [c.name, c.order])).toEqual([
        ['道具', 0],
        ['素材', 1],
        ['武器', 2],
      ]);
    });

    it('壊れた画像はその 1 枚だけを落とし、オブジェクトは取り込む', async () => {
      const sourceId = await seed('ゲームA');
      const file = await transfer.exportProject(sourceId);
      const iron = file.masters.find((m) => m.name === '鉄鉱石');
      iron!.image = { ...iron!.image!, data: '!!! not base64 !!!' };

      const targetId = await transferTo('ゲームB', file);

      await masters.load(targetId);
      const imported = masters.all().find((m) => m.name === '鉄鉱石');
      expect(imported).toBeDefined();
      expect(await images.get(imported!.id)).toBeNull();
    });

    it('存在しないプロジェクトへは取り込まない', async () => {
      const sourceId = await seed('ゲームA');
      const file = await transfer.exportProject(sourceId);

      await expect(transfer.import('missing', file, 'skip')).rejects.toThrow(NotFoundError);
    });

    it('途中で失敗したら 1 件も書き込まれない', async () => {
      const sourceId = await seed('ゲームA');
      const file = await transfer.exportProject(sourceId);
      const target = await projects.create('ゲームB');
      const failure = new Error('書き込み失敗');
      const repository = TestBed.inject(MasterRepository);
      const put = repository.put.bind(repository);
      let calls = 0;
      vi.spyOn(repository, 'put').mockImplementation(async (master, tx) => {
        calls += 1;
        if (calls === 2) {
          throw failure;
        }
        return put(master, tx);
      });

      await expect(transfer.import(target.id, file, 'skip')).rejects.toThrow(failure);

      expect(await repository.countByProject(target.id)).toBe(0);
      expect(await TestBed.inject(CategoryRepository).countByProject(target.id)).toBe(0);
      expect(await TestBed.inject(TagRepository).countByProject(target.id)).toBe(0);
      expect(await TestBed.inject(MasterImageRepository).getByProject(target.id)).toEqual([]);
    });

    it('往復させても内容が変わらない', async () => {
      const sourceId = await seed('ゲームA');
      const file = await transfer.exportProject(sourceId);

      const targetId = await transferTo('ゲームB', file);
      const roundTrip = await transfer.exportProject(targetId);

      expect(roundTrip.masters).toEqual(file.masters);
      expect(roundTrip.categories).toEqual(file.categories);
      expect(roundTrip.tags).toEqual(file.tags);
    });
  });

  describe('preview', () => {
    it('取り込み先の現状と突き合わせて件数を数える', async () => {
      const sourceId = await seed('ゲームA');
      const file = await transfer.exportProject(sourceId);
      const target = await projects.create('ゲームB');
      await masters.create(target.id, { name: '鉄鉱石' });
      await categories.create(target.id, '素材');

      const preview = await transfer.preview(target.id, file);

      expect(preview).toEqual({
        added: 1,
        existing: 1,
        images: 1,
        // 「素材」は既にあるので「武器」だけ
        newCategories: 1,
        newTags: 2,
      });
    });

    it('数えるだけで書き込まない', async () => {
      const sourceId = await seed('ゲームA');
      const file = await transfer.exportProject(sourceId);
      const target = await projects.create('ゲームB');

      await transfer.preview(target.id, file);

      expect(await TestBed.inject(MasterRepository).countByProject(target.id)).toBe(0);
      expect(await TestBed.inject(CategoryRepository).countByProject(target.id)).toBe(0);
    });
  });
});
