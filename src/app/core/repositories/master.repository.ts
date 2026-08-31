import { Injectable } from '@angular/core';
import { getDb, TalliaTransaction } from '../db/database';
import { Master } from '../db/schema';

/** `masters` ストアの永続化のみを担う */
@Injectable({ providedIn: 'root' })
export class MasterRepository {
  async getByProject(projectId: string, tx?: TalliaTransaction): Promise<Master[]> {
    if (tx) {
      return tx.objectStore('masters').index('by-project').getAll(projectId);
    }
    return (await getDb()).getAllFromIndex('masters', 'by-project', projectId);
  }

  async getById(id: string, tx?: TalliaTransaction): Promise<Master | undefined> {
    if (tx) {
      return tx.objectStore('masters').get(id);
    }
    return (await getDb()).get('masters', id);
  }

  async findByName(
    projectId: string,
    name: string,
    tx?: TalliaTransaction,
  ): Promise<Master | undefined> {
    const key: [string, string] = [projectId, name];
    if (tx) {
      return tx.objectStore('masters').index('by-project-name').get(key);
    }
    return (await getDb()).getFromIndex('masters', 'by-project-name', key);
  }

  async put(m: Master, tx?: TalliaTransaction): Promise<void> {
    if (tx) {
      await tx.objectStore('masters').put(m);
      return;
    }
    await (await getDb()).put('masters', m);
  }

  async delete(id: string, tx?: TalliaTransaction): Promise<void> {
    if (tx) {
      await tx.objectStore('masters').delete(id);
      return;
    }
    await (await getDb()).delete('masters', id);
  }

  async deleteByProject(projectId: string, tx?: TalliaTransaction): Promise<void> {
    if (tx) {
      const store = tx.objectStore('masters');
      const keys = await store.index('by-project').getAllKeys(projectId);
      await Promise.all(keys.map((key) => store.delete(key)));
      return;
    }
    const db = await getDb();
    const ownTx = db.transaction('masters', 'readwrite');
    const keys = await ownTx.store.index('by-project').getAllKeys(projectId);
    await Promise.all(keys.map((key) => ownTx.store.delete(key)));
    await ownTx.done;
  }

  async countByProject(projectId: string, tx?: TalliaTransaction): Promise<number> {
    if (tx) {
      return tx.objectStore('masters').index('by-project').count(projectId);
    }
    return (await getDb()).countFromIndex('masters', 'by-project', projectId);
  }

  async clear(tx?: TalliaTransaction): Promise<void> {
    if (tx) {
      await tx.objectStore('masters').clear();
      return;
    }
    await (await getDb()).clear('masters');
  }
}
