import { Injectable } from '@angular/core';
import { getDb, TalliaTransaction } from '../db/database';
import { Tag } from '../db/schema';

/** `tags` ストアの永続化のみを担う */
@Injectable({ providedIn: 'root' })
export class TagRepository {
  async getByProject(projectId: string, tx?: TalliaTransaction): Promise<Tag[]> {
    if (tx) {
      return tx.objectStore('tags').index('by-project').getAll(projectId);
    }
    return (await getDb()).getAllFromIndex('tags', 'by-project', projectId);
  }

  async getById(id: string, tx?: TalliaTransaction): Promise<Tag | undefined> {
    if (tx) {
      return tx.objectStore('tags').get(id);
    }
    return (await getDb()).get('tags', id);
  }

  async findByName(
    projectId: string,
    name: string,
    tx?: TalliaTransaction,
  ): Promise<Tag | undefined> {
    const key: [string, string] = [projectId, name];
    if (tx) {
      return tx.objectStore('tags').index('by-project-name').get(key);
    }
    return (await getDb()).getFromIndex('tags', 'by-project-name', key);
  }

  async put(tag: Tag, tx?: TalliaTransaction): Promise<void> {
    if (tx) {
      await tx.objectStore('tags').put(tag);
      return;
    }
    await (await getDb()).put('tags', tag);
  }

  async delete(id: string, tx?: TalliaTransaction): Promise<void> {
    if (tx) {
      await tx.objectStore('tags').delete(id);
      return;
    }
    await (await getDb()).delete('tags', id);
  }

  async deleteByProject(projectId: string, tx?: TalliaTransaction): Promise<void> {
    if (tx) {
      const store = tx.objectStore('tags');
      const keys = await store.index('by-project').getAllKeys(projectId);
      await Promise.all(keys.map((key) => store.delete(key)));
      return;
    }
    const db = await getDb();
    const ownTx = db.transaction('tags', 'readwrite');
    const keys = await ownTx.store.index('by-project').getAllKeys(projectId);
    await Promise.all(keys.map((key) => ownTx.store.delete(key)));
    await ownTx.done;
  }

  async countByProject(projectId: string, tx?: TalliaTransaction): Promise<number> {
    if (tx) {
      return tx.objectStore('tags').index('by-project').count(projectId);
    }
    return (await getDb()).countFromIndex('tags', 'by-project', projectId);
  }

  async getAll(tx?: TalliaTransaction): Promise<Tag[]> {
    if (tx) {
      return tx.objectStore('tags').getAll();
    }
    return (await getDb()).getAll('tags');
  }

  async clear(tx?: TalliaTransaction): Promise<void> {
    if (tx) {
      await tx.objectStore('tags').clear();
      return;
    }
    await (await getDb()).clear('tags');
  }
}
