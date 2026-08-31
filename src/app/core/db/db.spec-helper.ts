import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { DB_NAME, closeDb } from './database';

/** 各テストの前に DB を作り直す */
export async function resetDatabase(): Promise<void> {
  await closeDb();
  await deleteDB(DB_NAME);
}
