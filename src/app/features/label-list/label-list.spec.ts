import { TestBed } from '@angular/core/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../../app.routes';
import { resetDatabase } from '../../core/db/db.spec-helper';
import { CategoryService } from '../../core/services/category.service';
import { ProjectService } from '../../core/services/project.service';
import { TagService } from '../../core/services/tag.service';

/** ルートの `data.kind` が input に届き、画面がその種別として振る舞うことを確かめる */
describe('LabelList', () => {
  let projectId: string;

  beforeEach(async () => {
    await resetDatabase();
    TestBed.configureTestingModule({
      providers: [provideRouter(routes, withComponentInputBinding())],
    });
    projectId = (await TestBed.inject(ProjectService).create('ゲームA')).id;
    await TestBed.inject(CategoryService).create(projectId, '素材');
    await TestBed.inject(TagService).create(projectId, 'レア');
  });

  async function textAt(path: string): Promise<string> {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(`/projects/${projectId}/${path}`);
    await harness.fixture.whenStable();
    harness.detectChanges();
    return harness.routeNativeElement?.textContent ?? '';
  }

  it('categories ルートではカテゴリマスタとして表示する', async () => {
    const text = await textAt('categories');

    expect(text).toContain('カテゴリマスタ');
    expect(text).toContain('素材');
    expect(text).not.toContain('レア');
  });

  it('tags ルートではタグマスタとして表示する', async () => {
    const text = await textAt('tags');

    expect(text).toContain('タグマスタ');
    expect(text).toContain('レア');
    expect(text).not.toContain('素材');
  });
});
