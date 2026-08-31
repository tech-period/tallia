import { openDB } from 'idb';
import { closeDb, DB_NAME, getDb } from './database';
import { resetDatabase } from './db.spec-helper';

const TIMESTAMP = '2026-08-31T12:00:00.000Z';

/** バージョン 3 の DB を作り、当時の形の Master を入れる */
async function seedVersion3(): Promise<void> {
  const db = await openDB(DB_NAME, 3, {
    upgrade(database) {
      database.createObjectStore('projects', { keyPath: 'id' });
      const cases = database.createObjectStore('cases', { keyPath: 'id' });
      cases.createIndex('by-project', 'projectId');
      const masters = database.createObjectStore('masters', { keyPath: 'id' });
      masters.createIndex('by-project', 'projectId');
      masters.createIndex('by-project-name', ['projectId', 'name']);
      const instances = database.createObjectStore('instances', { keyPath: 'id' });
      instances.createIndex('by-project', 'projectId');
      instances.createIndex('by-case', 'caseId');
      instances.createIndex('by-master', 'masterId');
      instances.createIndex('by-case-master', ['caseId', 'masterId'], { unique: true });
      database.createObjectStore('projectImages', { keyPath: 'projectId' });
      const masterImages = database.createObjectStore('masterImages', { keyPath: 'masterId' });
      masterImages.createIndex('by-project', 'projectId');
    },
  });
  const legacy = [
    { id: 'm1', projectId: 'p1', name: '鉄鉱石', category: '素材', tags: ['レア', '換金用'] },
    { id: 'm2', projectId: 'p1', name: '銅鉱石', category: '素材', tags: ['換金用'] },
    { id: 'm3', projectId: 'p2', name: '木の棒', category: '武器', tags: [] },
    { id: 'm4', projectId: 'p1', name: '薬草', tags: [] },
  ];
  for (const master of legacy) {
    await db.put('masters', { ...master, createdAt: TIMESTAMP, updatedAt: TIMESTAMP });
  }
  db.close();
}

describe('DB マイグレーション（3 → 4）', () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedVersion3();
  });

  afterEach(async () => {
    await closeDb();
  });

  it('文字列のカテゴリ / タグをレコードに起こし、Master は ID 参照になる', async () => {
    const db = await getDb();

    const categories = await db.getAll('categories');
    const tags = await db.getAll('tags');
    const first = await db.get('masters', 'm1');
    const second = await db.get('masters', 'm2');

    // 同じ名前はプロジェクトごとに 1 件へまとまる
    expect(categories.map((c) => [c.projectId, c.name]).sort()).toEqual([
      ['p1', '素材'],
      ['p2', '武器'],
    ]);
    expect(tags.map((t) => [t.projectId, t.name]).sort()).toEqual([
      ['p1', 'レア'],
      ['p1', '換金用'],
    ]);

    const material = categories.find((c) => c.name === '素材');
    expect(first?.categoryId).toBe(material?.id);
    expect(second?.categoryId).toBe(material?.id);
    expect(first?.tagIds).toHaveLength(2);
    expect(second?.tagIds).toEqual(first?.tagIds.slice(1));
  });

  it('カテゴリ・タグを持たない Master は空のまま移行する', async () => {
    const db = await getDb();

    const master = await db.get('masters', 'm4');

    expect(master?.categoryId).toBeUndefined();
    expect(master?.tagIds).toEqual([]);
  });

  it('order はプロジェクトごとに 0 から振られる', async () => {
    const db = await getDb();

    const categories = await db.getAllFromIndex('categories', 'by-project', 'p1');
    const others = await db.getAllFromIndex('categories', 'by-project', 'p2');

    expect(categories.map((c) => c.order)).toEqual([0]);
    expect(others.map((c) => c.order)).toEqual([0]);
  });
});
