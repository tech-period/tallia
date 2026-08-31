import { Service, inject } from '@angular/core';
import { Master } from '../db/schema';
import { TagRepository } from '../repositories/tag.repository';
import { LabelService } from './label.service';

/** オブジェクトのタグ（1 オブジェクトに複数）を管理する */
@Service()
export class TagService extends LabelService {
  protected readonly repository = inject(TagRepository);
  protected readonly entityName = 'タグ';

  protected usedBy(master: Master, labelId: string): boolean {
    return master.tagIds.includes(labelId);
  }
}
