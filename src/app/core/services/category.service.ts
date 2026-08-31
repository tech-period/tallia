import { Service, inject } from '@angular/core';
import { Master } from '../db/schema';
import { CategoryRepository } from '../repositories/category.repository';
import { LabelService } from './label.service';

/** オブジェクトのカテゴリ（1 オブジェクトにつき 1 つ）を管理する */
@Service()
export class CategoryService extends LabelService {
  protected readonly repository = inject(CategoryRepository);
  protected readonly entityName = 'カテゴリ';

  protected usedBy(master: Master, labelId: string): boolean {
    return master.categoryId === labelId;
  }
}
