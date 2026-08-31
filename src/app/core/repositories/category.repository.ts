import { Injectable } from '@angular/core';
import { getDb, TalliaTransaction } from '../db/database';
import { Category } from '../db/schema';

/** `categories` ストアの永続化のみを担う */
@Injectable({ providedIn: 'root' })
export class CategoryRepository {
  async getByProject(projectId: string, tx?: TalliaTransaction): Promise<Category[]> {
    if (tx) {
      return tx.objectStore('categories').index('by-project').getAll(projectId);
    }
    return (await getDb()).getAllFromIndex('categories', 'by-project', projectId);
  }

  async getById(id: string, tx?: TalliaTransaction): Promise<Category | undefined> {
    if (tx) {
      return tx.objectStore('categories').get(id);
    }
    return (await getDb()).get('categories', id);
  }

  async findByName(
    projectId: string,
    name: string,
    tx?: TalliaTransaction,
  ): Promise<Category | undefined> {
    const key: [string, string] = [projectId, name];
    if (tx) {
      return tx.objectStore('categories').index('by-project-name').get(key);
    }
    return (await getDb()).getFromIndex('categories', 'by-project-name', key);
  }

  async put(category: Category, tx?: TalliaTransaction): Promise<void> {
    if (tx) {
      await tx.objectStore('categories').put(category);
      return;
    }
    await (await getDb()).put('categories', category);
  }

  async delete(id: string, tx?: TalliaTransaction): Promise<void> {
    if (tx) {
      await tx.objectStore('categories').delete(id);
      return;
    }
    await (await getDb()).delete('categories', id);
  }

  async deleteByProject(projectId: string, tx?: TalliaTransaction): Promise<void> {
    if (tx) {
      const store = tx.objectStore('categories');
      const keys = await store.index('by-project').getAllKeys(projectId);
      await Promise.all(keys.map((key) => store.delete(key)));
      return;
    }
    const db = await getDb();
    const ownTx = db.transaction('categories', 'readwrite');
    const keys = await ownTx.store.index('by-project').getAllKeys(projectId);
    await Promise.all(keys.map((key) => ownTx.store.delete(key)));
    await ownTx.done;
  }

  async countByProject(projectId: string, tx?: TalliaTransaction): Promise<number> {
    if (tx) {
      return tx.objectStore('categories').index('by-project').count(projectId);
    }
    return (await getDb()).countFromIndex('categories', 'by-project', projectId);
  }

  async getAll(tx?: TalliaTransaction): Promise<Category[]> {
    if (tx) {
      return tx.objectStore('categories').getAll();
    }
    return (await getDb()).getAll('categories');
  }

  async clear(tx?: TalliaTransaction): Promise<void> {
    if (tx) {
      await tx.objectStore('categories').clear();
      return;
    }
    await (await getDb()).clear('categories');
  }
}
