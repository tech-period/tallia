import { TestBed } from '@angular/core/testing';
import { resetDatabase } from '../db/db.spec-helper';
import { MASTER_FILE_FORMAT, MASTER_FILE_VERSION, MasterFile } from '../db/schema';
import { CaseRepository } from '../repositories/case.repository';
import { CategoryRepository } from '../repositories/category.repository';
import { MasterImageRepository } from '../repositories/master-image.repository';
import { MasterRepository } from '../repositories/master.repository';
import { TagRepository } from '../repositories/tag.repository';
import { bytesToBase64 } from '../../shared/utils/image';
import { CaseService } from './case.service';
import { CategoryService } from './category.service';
import { InvalidMasterFileError, NotFoundError } from './errors';
import { InstanceService } from './instance.service';
import { MasterImageService } from './master-image.service';
import { MasterService } from './master.service';
import { MasterTransferService } from './master-transfer.service';
import { ProjectService } from './project.service';
import { TagService } from './tag.service';

describe('MasterTransferService', () => {
  let transfer: MasterTransferService;
  let projects: ProjectService;
  let cases: CaseService;
  let masters: MasterService;
  let categories: CategoryService;
  let tags: TagService;
  let images: MasterImageService;

  beforeEach(async () => {
    await resetDatabase();
    TestBed.configureTestingModule({});
    transfer = TestBed.inject(MasterTransferService);
    projects = TestBed.inject(ProjectService);
    cases = TestBed.inject(CaseService);
    masters = TestBed.inject(MasterService);
    categories = TestBed.inject(CategoryService);
    tags = TestBed.inject(TagService);
    images = TestBed.inject(MasterImageService);
  });

  /** 中身は問わないので固定のバイト列でよい */
  function payload(byte = 1) {
    return {
      data: new Uint8Array([byte, 2, 3, 4]).buffer,
      type: 'image/webp',
      width: 8,
      height: 8,
    };
  }

  /** マスタ 4 種が一通り入ったプロジェクトを作る */
  async function seed(projectName: string): Promise<string> {
    const project = await projects.create(projectName);
    await cases.create(project.id, '1章', '最初のダンジョン');
    await cases.create(project.id, '2章');
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
    it('マスタ 4 種を、オブジェクトの画像ごと書き出す', async () => {
      const projectId = await seed('ゲームA');

      const file = await transfer.exportProject(projectId);

      expect(file.format).toBe(MASTER_FILE_FORMAT);
      expect(file.version).toBe(MASTER_FILE_VERSION);
      expect(file.source.projectName).toBe('ゲームA');
      // ケース・カテゴリ・タグは表示順のまま
      expect(file.cases).toEqual([{ name: '1章', note: '最初のダンジョン' }, { name: '2章' }]);
      expect(file.categories).toEqual(['素材', '武器']);
      expect(file.tags).toEqual(['レア', '換金用']);
      // オブジェクトは名前順（日本語の読み順）で固定される
      expect(file.masters.map((m) => m.name)).toEqual(['鉄鉱石', '薬草']);
    });

    it('オブジェクトはカテゴリ・タグとの紐付けを名前で持つ', async () => {
      const projectId = await seed('ゲームA');

      const file = await transfer.exportProject(projectId);

      expect(file.masters.find((m) => m.name === '鉄鉱石')).toEqual({
        name: '鉄鉱石',
        category: '素材',
        tags: ['レア'],
        note: '洞窟で拾える',
        image: { data: bytesToBase64(payload().data), type: 'image/webp', width: 8, height: 8 },
      });
      // 紐付けが無いオブジェクトは項目ごと省く
      expect(file.masters.find((m) => m.name === '薬草')).toEqual({ name: '薬草' });
    });

    it('ID を一切含めない', async () => {
      const projectId = await seed('ゲームA');

      const file = await transfer.exportProject(projectId);

      expect(JSON.stringify(file)).not.toContain(projectId);
    });

    it('記録した個数（Instance）は含めない', async () => {
      const projectId = await seed('ゲームA');
      await cases.load(projectId);
      await masters.load(projectId);
      const target = cases.all()[0];
      const master = masters.all()[0];
      await TestBed.inject(InstanceService).addToCase(target.id, master.id, 3);

      const file = await transfer.exportProject(projectId);

      expect(Object.keys(file)).toEqual([
        'format',
        'version',
        'exportedAt',
        'source',
        'cases',
        'categories',
        'tags',
        'masters',
      ]);
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
        cases: [],
        categories: [],
        tags: [],
        masters: [{ name: '鉄鉱石' }],
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

    it('マスタ 1 種だけのファイルも取り込める', () => {
      const file = transfer.parse(serialize({ masters: [], categories: ['素材'] }));

      expect(file.categories).toEqual(['素材']);
      expect(file.masters).toEqual([]);
    });

    it('名前が空の行と、同じ配列の中で重複した名前の 2 件目以降を落とす', () => {
      const file = transfer.parse(
        serialize({
          categories: ['素材', '  ', '素材', '武器'],
          masters: [
            { name: '鉄鉱石', note: '先勝ち' },
            { name: '  ' },
            { name: '鉄鉱石', note: 'あと勝ちしない' },
            { name: '薬草' },
          ],
        }),
      );

      expect(file.categories).toEqual(['素材', '武器']);
      expect(file.masters.map((m) => m.name)).toEqual(['鉄鉱石', '薬草']);
      expect(file.masters[0].note).toBe('先勝ち');
    });

    it('分類の一覧に無い名前がオブジェクトから参照されていたら、一覧へ足す', () => {
      const file = transfer.parse(
        serialize({
          categories: ['素材'],
          tags: [],
          masters: [{ name: '鉄鉱石', category: '鉱石', tags: ['レア', 'レア'] }],
        }),
      );

      expect(file.categories).toEqual(['素材', '鉱石']);
      expect(file.tags).toEqual(['レア']);
      expect(file.masters[0]).toEqual({ name: '鉄鉱石', category: '鉱石', tags: ['レア'] });
    });

    it('どのマスタも空なら取り込めない', () => {
      expect(() => transfer.parse(serialize({ masters: [] }))).toThrow(/1 件もありません/);
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

    it('マスタ 4 種を別プロジェクトへ移せる', async () => {
      const sourceId = await seed('ゲームA');
      const file = await transfer.exportProject(sourceId);

      const targetId = await transferTo('ゲームB', file);

      await Promise.all([
        cases.load(targetId),
        categories.load(targetId),
        tags.load(targetId),
        masters.load(targetId),
      ]);
      expect(cases.all().map((c) => c.name)).toEqual(['1章', '2章']);
      expect(cases.all()[0].note).toBe('最初のダンジョン');
      expect(categories.all().map((c) => c.name)).toEqual(['素材', '武器']);
      expect(tags.all().map((t) => t.name)).toEqual(['レア', '換金用']);
      expect([...masters.all()].map((m) => m.name).sort()).toEqual(['薬草', '鉄鉱石'].sort());
    });

    it('オブジェクトの紐付けを、移し替え先で採番した ID に解決し直す', async () => {
      const sourceId = await seed('ゲームA');
      const file = await transfer.exportProject(sourceId);

      const targetId = await transferTo('ゲームB', file);

      await Promise.all([masters.load(targetId), categories.load(targetId), tags.load(targetId)]);
      const iron = masters.all().find((m) => m.name === '鉄鉱石');
      const material = categories.all().find((c) => c.name === '素材');
      const rare = tags.all().find((t) => t.name === 'レア');
      expect(iron?.categoryId).toBe(material?.id);
      expect(iron?.tagIds).toEqual([rare?.id]);
      // メモと画像も運ばれる
      expect(iron?.note).toBe('洞窟で拾える');
      expect(await images.get(iron!.id)).toMatchObject({ type: 'image/webp', size: 4 });
      // 紐付けの無いオブジェクトは未設定のまま
      expect(masters.all().find((m) => m.name === '薬草')?.categoryId).toBeUndefined();
      expect(masters.all().find((m) => m.name === '薬草')?.tagIds).toEqual([]);
    });

    it('取り込み先に同名の分類があれば、そちらの ID に紐付ける', async () => {
      const sourceId = await seed('ゲームA');
      const file = await transfer.exportProject(sourceId);
      const target = await projects.create('ゲームB');
      const material = await categories.create(target.id, '素材');

      await transfer.import(target.id, file, 'skip');

      await masters.load(target.id);
      expect(masters.all().find((m) => m.name === '鉄鉱石')?.categoryId).toBe(material.id);
    });

    it('紐付けを持たない version 1 のファイルは未設定で取り込む', async () => {
      const file = transfer.parse(
        JSON.stringify({
          format: MASTER_FILE_FORMAT,
          version: 1,
          exportedAt: '2026-08-31T12:00:00.000Z',
          source: { projectName: 'ゲームA' },
          cases: [],
          categories: ['素材'],
          tags: [],
          masters: [{ name: '鉄鉱石' }],
        }),
      );

      const targetId = await transferTo('ゲームB', file);

      await masters.load(targetId);
      const iron = masters.all().find((m) => m.name === '鉄鉱石');
      expect(iron?.categoryId).toBeUndefined();
      expect(iron?.tagIds).toEqual([]);
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

      expect(await TestBed.inject(MasterRepository).countByProject(sourceId)).toBe(2);
      expect(await TestBed.inject(CategoryRepository).countByProject(sourceId)).toBe(2);
    });

    it('skip は同名のものを飛ばす', async () => {
      const sourceId = await seed('ゲームA');
      const file = await transfer.exportProject(sourceId);
      const target = await projects.create('ゲームB');
      await masters.create(target.id, { name: '鉄鉱石', note: '取り込み先のメモ' });
      await cases.create(target.id, '1章', '取り込み先のメモ');

      const result = await transfer.import(target.id, file, 'skip');

      expect(result.added).toEqual({ cases: 1, categories: 2, tags: 2, masters: 1 });
      expect(result.skipped).toEqual({ cases: 1, categories: 0, tags: 0, masters: 1 });
      await masters.load(target.id);
      expect(masters.all().find((m) => m.name === '鉄鉱石')?.note).toBe('取り込み先のメモ');
    });

    it('overwrite は同名のメモをファイルの内容で置き換える', async () => {
      const sourceId = await seed('ゲームA');
      const file = await transfer.exportProject(sourceId);
      const target = await projects.create('ゲームB');
      const existing = await masters.create(target.id, { name: '鉄鉱石', note: '古いメモ' });

      const result = await transfer.import(target.id, file, 'overwrite');

      expect(result.updated.masters).toBe(1);
      await masters.load(target.id);
      const iron = masters.all().find((m) => m.name === '鉄鉱石');
      // ID は保たれ、中身だけが差し替わる（記録した個数が壊れない）
      expect(iron?.id).toBe(existing.id);
      expect(iron?.note).toBe('洞窟で拾える');
    });

    it('overwrite は取り込み先の紐付けもファイルの内容に置き換える', async () => {
      const sourceId = await seed('ゲームA');
      const file = await transfer.exportProject(sourceId);
      const target = await projects.create('ゲームB');
      const tool = await categories.create(target.id, '道具');
      const existing = await masters.create(target.id, { name: '鉄鉱石', categoryId: tool.id });

      await transfer.import(target.id, file, 'overwrite');

      await Promise.all([masters.load(target.id), categories.load(target.id)]);
      const material = categories.all().find((c) => c.name === '素材');
      expect(masters.all().find((m) => m.id === existing.id)?.categoryId).toBe(material?.id);
      // 取り込み先にしか無いカテゴリはそのまま残る
      expect(categories.all().map((c) => c.name)).toContain('道具');
    });

    it('skip は取り込み先の紐付けに触れない', async () => {
      const sourceId = await seed('ゲームA');
      const file = await transfer.exportProject(sourceId);
      const target = await projects.create('ゲームB');
      const tool = await categories.create(target.id, '道具');
      const existing = await masters.create(target.id, { name: '鉄鉱石', categoryId: tool.id });

      await transfer.import(target.id, file, 'skip');

      await masters.load(target.id);
      expect(masters.all().find((m) => m.id === existing.id)?.categoryId).toBe(tool.id);
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

    it('同名のカテゴリ・タグはモードに関わらず作り直さない', async () => {
      const sourceId = await seed('ゲームA');
      const file = await transfer.exportProject(sourceId);
      const target = await projects.create('ゲームB');
      const existing = await categories.create(target.id, '素材');

      const result = await transfer.import(target.id, file, 'overwrite');

      expect(result.added.categories).toBe(1);
      expect(result.updated.categories).toBe(0);
      expect(result.skipped.categories).toBe(1);
      await categories.load(target.id);
      expect(categories.all().find((c) => c.name === '素材')?.id).toBe(existing.id);
    });

    it('新しく作るケース・分類の order は取り込み先の末尾から続ける', async () => {
      const sourceId = await seed('ゲームA');
      const file = await transfer.exportProject(sourceId);
      const target = await projects.create('ゲームB');
      await categories.create(target.id, '道具');
      await cases.create(target.id, '序章');

      await transfer.import(target.id, file, 'skip');

      await Promise.all([categories.load(target.id), cases.load(target.id)]);
      expect(categories.all().map((c) => [c.name, c.order])).toEqual([
        ['道具', 0],
        ['素材', 1],
        ['武器', 2],
      ]);
      expect(cases.all().map((c) => c.name)).toEqual(['序章', '1章', '2章']);
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
      expect(await TestBed.inject(CaseRepository).countByProject(target.id)).toBe(0);
      expect(await TestBed.inject(CategoryRepository).countByProject(target.id)).toBe(0);
      expect(await TestBed.inject(TagRepository).countByProject(target.id)).toBe(0);
      expect(await TestBed.inject(MasterImageRepository).getByProject(target.id)).toEqual([]);
    });

    it('往復させても内容が変わらない', async () => {
      const sourceId = await seed('ゲームA');
      const file = await transfer.exportProject(sourceId);

      const targetId = await transferTo('ゲームB', file);
      const roundTrip = await transfer.exportProject(targetId);

      expect(roundTrip.cases).toEqual(file.cases);
      expect(roundTrip.categories).toEqual(file.categories);
      expect(roundTrip.tags).toEqual(file.tags);
      expect(roundTrip.masters).toEqual(file.masters);
    });
  });

  describe('preview', () => {
    it('取り込み先の現状と突き合わせて、マスタごとに数える', async () => {
      const sourceId = await seed('ゲームA');
      const file = await transfer.exportProject(sourceId);
      const target = await projects.create('ゲームB');
      await masters.create(target.id, { name: '鉄鉱石' });
      await categories.create(target.id, '素材');
      await cases.create(target.id, '1章');

      const preview = await transfer.preview(target.id, file);

      expect(preview).toEqual({
        added: { cases: 1, categories: 1, tags: 2, masters: 1 },
        existing: { cases: 1, categories: 1, tags: 0, masters: 1 },
        images: 1,
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
