import { Injectable } from '@angular/core';
import { getDb, TalliaTransaction } from '../db/database';
import { Project } from '../db/schema';

/**
 * `projects` ストアの永続化のみを担う。業務ルールは Service 層が持つ。
 * 移植性のため Angular API は `@Injectable()` 以外使わない。
 */
@Injectable({ providedIn: 'root' })
export class ProjectRepository {
  async getAll(tx?: TalliaTransaction): Promise<Project[]> {
    if (tx) {
      return tx.objectStore('projects').getAll();
    }
    return (await getDb()).getAll('projects');
  }

  async getById(id: string, tx?: TalliaTransaction): Promise<Project | undefined> {
    if (tx) {
      return tx.objectStore('projects').get(id);
    }
    return (await getDb()).get('projects', id);
  }

  async put(project: Project, tx?: TalliaTransaction): Promise<void> {
    if (tx) {
      await tx.objectStore('projects').put(project);
      return;
    }
    await (await getDb()).put('projects', project);
  }

  async delete(id: string, tx?: TalliaTransaction): Promise<void> {
    if (tx) {
      await tx.objectStore('projects').delete(id);
      return;
    }
    await (await getDb()).delete('projects', id);
  }

  async clear(tx?: TalliaTransaction): Promise<void> {
    if (tx) {
      await tx.objectStore('projects').clear();
      return;
    }
    await (await getDb()).clear('projects');
  }
}
