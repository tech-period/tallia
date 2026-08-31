import { Injectable } from '@angular/core';
import { getDb, TalliaTransaction } from '../db/database';
import { ProjectImage } from '../db/schema';

/**
 * `projectImages` ストアの永続化のみを担う。業務ルールは Service 層が持つ。
 * 移植性のため Angular API は `@Injectable()` 以外使わない。
 */
@Injectable({ providedIn: 'root' })
export class ProjectImageRepository {
  async getAll(tx?: TalliaTransaction): Promise<ProjectImage[]> {
    if (tx) {
      return tx.objectStore('projectImages').getAll();
    }
    return (await getDb()).getAll('projectImages');
  }

  async getByProject(projectId: string, tx?: TalliaTransaction): Promise<ProjectImage | undefined> {
    if (tx) {
      return tx.objectStore('projectImages').get(projectId);
    }
    return (await getDb()).get('projectImages', projectId);
  }

  async put(image: ProjectImage, tx?: TalliaTransaction): Promise<void> {
    if (tx) {
      await tx.objectStore('projectImages').put(image);
      return;
    }
    await (await getDb()).put('projectImages', image);
  }

  async deleteByProject(projectId: string, tx?: TalliaTransaction): Promise<void> {
    if (tx) {
      await tx.objectStore('projectImages').delete(projectId);
      return;
    }
    await (await getDb()).delete('projectImages', projectId);
  }

  async clear(tx?: TalliaTransaction): Promise<void> {
    if (tx) {
      await tx.objectStore('projectImages').clear();
      return;
    }
    await (await getDb()).clear('projectImages');
  }
}
