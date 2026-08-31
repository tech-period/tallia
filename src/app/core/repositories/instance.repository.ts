import { Injectable } from '@angular/core';
import { getDb, TalliaTransaction } from '../db/database';
import { Instance } from '../db/schema';

/** `instances` ストアの永続化のみを担う */
@Injectable({ providedIn: 'root' })
export class InstanceRepository {
  async getByCase(caseId: string, tx?: TalliaTransaction): Promise<Instance[]> {
    if (tx) {
      return tx.objectStore('instances').index('by-case').getAll(caseId);
    }
    return (await getDb()).getAllFromIndex('instances', 'by-case', caseId);
  }

  async getById(id: string, tx?: TalliaTransaction): Promise<Instance | undefined> {
    if (tx) {
      return tx.objectStore('instances').get(id);
    }
    return (await getDb()).get('instances', id);
  }

  async getByMaster(masterId: string, tx?: TalliaTransaction): Promise<Instance[]> {
    if (tx) {
      return tx.objectStore('instances').index('by-master').getAll(masterId);
    }
    return (await getDb()).getAllFromIndex('instances', 'by-master', masterId);
  }

  async getByProject(projectId: string, tx?: TalliaTransaction): Promise<Instance[]> {
    if (tx) {
      return tx.objectStore('instances').index('by-project').getAll(projectId);
    }
    return (await getDb()).getAllFromIndex('instances', 'by-project', projectId);
  }

  async findByCaseAndMaster(
    caseId: string,
    masterId: string,
    tx?: TalliaTransaction,
  ): Promise<Instance | undefined> {
    const key: [string, string] = [caseId, masterId];
    if (tx) {
      return tx.objectStore('instances').index('by-case-master').get(key);
    }
    return (await getDb()).getFromIndex('instances', 'by-case-master', key);
  }

  async put(i: Instance, tx?: TalliaTransaction): Promise<void> {
    if (tx) {
      await tx.objectStore('instances').put(i);
      return;
    }
    await (await getDb()).put('instances', i);
  }

  async delete(id: string, tx?: TalliaTransaction): Promise<void> {
    if (tx) {
      await tx.objectStore('instances').delete(id);
      return;
    }
    await (await getDb()).delete('instances', id);
  }

  async deleteByCase(caseId: string, tx?: TalliaTransaction): Promise<void> {
    if (tx) {
      const store = tx.objectStore('instances');
      const keys = await store.index('by-case').getAllKeys(caseId);
      await Promise.all(keys.map((key) => store.delete(key)));
      return;
    }
    const db = await getDb();
    const ownTx = db.transaction('instances', 'readwrite');
    const keys = await ownTx.store.index('by-case').getAllKeys(caseId);
    await Promise.all(keys.map((key) => ownTx.store.delete(key)));
    await ownTx.done;
  }

  async deleteByProject(projectId: string, tx?: TalliaTransaction): Promise<void> {
    if (tx) {
      const store = tx.objectStore('instances');
      const keys = await store.index('by-project').getAllKeys(projectId);
      await Promise.all(keys.map((key) => store.delete(key)));
      return;
    }
    const db = await getDb();
    const ownTx = db.transaction('instances', 'readwrite');
    const keys = await ownTx.store.index('by-project').getAllKeys(projectId);
    await Promise.all(keys.map((key) => ownTx.store.delete(key)));
    await ownTx.done;
  }

  async countByMaster(masterId: string, tx?: TalliaTransaction): Promise<number> {
    if (tx) {
      return tx.objectStore('instances').index('by-master').count(masterId);
    }
    return (await getDb()).countFromIndex('instances', 'by-master', masterId);
  }

  async clear(tx?: TalliaTransaction): Promise<void> {
    if (tx) {
      await tx.objectStore('instances').clear();
      return;
    }
    await (await getDb()).clear('instances');
  }
}
