import { Injectable } from '@angular/core';
import { getDb, TalliaTransaction } from '../db/database';
import { Case } from '../db/schema';

/** `cases` ストアの永続化のみを担う */
@Injectable({ providedIn: 'root' })
export class CaseRepository {
  async getByProject(projectId: string, tx?: TalliaTransaction): Promise<Case[]> {
    if (tx) {
      return tx.objectStore('cases').index('by-project').getAll(projectId);
    }
    return (await getDb()).getAllFromIndex('cases', 'by-project', projectId);
  }

  async getById(id: string, tx?: TalliaTransaction): Promise<Case | undefined> {
    if (tx) {
      return tx.objectStore('cases').get(id);
    }
    return (await getDb()).get('cases', id);
  }

  async put(c: Case, tx?: TalliaTransaction): Promise<void> {
    if (tx) {
      await tx.objectStore('cases').put(c);
      return;
    }
    await (await getDb()).put('cases', c);
  }

  async delete(id: string, tx?: TalliaTransaction): Promise<void> {
    if (tx) {
      await tx.objectStore('cases').delete(id);
      return;
    }
    await (await getDb()).delete('cases', id);
  }

  async deleteByProject(projectId: string, tx?: TalliaTransaction): Promise<void> {
    if (tx) {
      const keys = await tx.objectStore('cases').index('by-project').getAllKeys(projectId);
      const store = tx.objectStore('cases');
      await Promise.all(keys.map((key) => store.delete(key)));
      return;
    }
    const db = await getDb();
    const ownTx = db.transaction('cases', 'readwrite');
    const keys = await ownTx.store.index('by-project').getAllKeys(projectId);
    await Promise.all(keys.map((key) => ownTx.store.delete(key)));
    await ownTx.done;
  }

  async countByProject(projectId: string, tx?: TalliaTransaction): Promise<number> {
    if (tx) {
      return tx.objectStore('cases').index('by-project').count(projectId);
    }
    return (await getDb()).countFromIndex('cases', 'by-project', projectId);
  }

  async clear(tx?: TalliaTransaction): Promise<void> {
    if (tx) {
      await tx.objectStore('cases').clear();
      return;
    }
    await (await getDb()).clear('cases');
  }
}
