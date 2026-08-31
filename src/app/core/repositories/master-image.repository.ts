import { Injectable } from '@angular/core';
import { getDb, TalliaTransaction } from '../db/database';
import { MasterImage } from '../db/schema';

/**
 * `masterImages` ストアの永続化のみを担う。業務ルールは Service 層が持つ。
 * 移植性のため Angular API は `@Injectable()` 以外使わない。
 */
@Injectable({ providedIn: 'root' })
export class MasterImageRepository {
  async getAll(tx?: TalliaTransaction): Promise<MasterImage[]> {
    if (tx) {
      return tx.objectStore('masterImages').getAll();
    }
    return (await getDb()).getAll('masterImages');
  }

  /** 表示中プロジェクトの画像だけを読む */
  async getByProject(projectId: string, tx?: TalliaTransaction): Promise<MasterImage[]> {
    if (tx) {
      return tx.objectStore('masterImages').index('by-project').getAll(projectId);
    }
    return (await getDb()).getAllFromIndex('masterImages', 'by-project', projectId);
  }

  async getByMaster(masterId: string, tx?: TalliaTransaction): Promise<MasterImage | undefined> {
    if (tx) {
      return tx.objectStore('masterImages').get(masterId);
    }
    return (await getDb()).get('masterImages', masterId);
  }

  async put(image: MasterImage, tx?: TalliaTransaction): Promise<void> {
    if (tx) {
      await tx.objectStore('masterImages').put(image);
      return;
    }
    await (await getDb()).put('masterImages', image);
  }

  async deleteByMaster(masterId: string, tx?: TalliaTransaction): Promise<void> {
    if (tx) {
      await tx.objectStore('masterImages').delete(masterId);
      return;
    }
    await (await getDb()).delete('masterImages', masterId);
  }

  async deleteByProject(projectId: string, tx?: TalliaTransaction): Promise<void> {
    if (tx) {
      const store = tx.objectStore('masterImages');
      const keys = await store.index('by-project').getAllKeys(projectId);
      await Promise.all(keys.map((key) => store.delete(key)));
      return;
    }
    const db = await getDb();
    const ownTx = db.transaction('masterImages', 'readwrite');
    const keys = await ownTx.store.index('by-project').getAllKeys(projectId);
    await Promise.all(keys.map((key) => ownTx.store.delete(key)));
    await ownTx.done;
  }

  async clear(tx?: TalliaTransaction): Promise<void> {
    if (tx) {
      await tx.objectStore('masterImages').clear();
      return;
    }
    await (await getDb()).clear('masterImages');
  }
}
