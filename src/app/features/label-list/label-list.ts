import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormField, form, maxLength, required } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { Label, Project } from '../../core/db/schema';
import { CategoryService } from '../../core/services/category.service';
import { toMessage } from '../../core/services/errors';
import { LabelService, LabelUsage } from '../../core/services/label.service';
import { ProjectService } from '../../core/services/project.service';
import { TagService } from '../../core/services/tag.service';
import { ConfirmDialog } from '../../shared/components/confirm-dialog';
import { EmptyState } from '../../shared/components/empty-state';
import { ErrorBanner } from '../../shared/components/error-banner';
import { IconButton } from '../../shared/components/icon-button';
import { InfoHint } from '../../shared/components/info-hint';
import { Modal } from '../../shared/components/modal';
import { firstErrorMessage } from '../../shared/utils/form';

/** どちらの分類マスタとして振る舞うか。ルートの `data.kind` で渡す */
export type LabelKind = 'category' | 'tag';

/** 画面に出す文言。カテゴリとタグの違いはここに集める */
interface LabelText {
  title: string;
  /** 「カテゴリ」「タグ」 */
  unit: string;
  hint: string;
  emptyDescription: string;
  placeholder: string;
}

const TEXTS: Record<LabelKind, LabelText> = {
  category: {
    title: 'カテゴリマスタ',
    unit: 'カテゴリ',
    hint: 'オブジェクトの大きな分類です。1 つのオブジェクトに 1 つだけ設定でき、オブジェクトの作成・編集画面で選びます。',
    emptyDescription: '「武器」「素材」など、オブジェクトを大きく分ける単位で追加します。',
    placeholder: '武器 / 素材 など',
  },
  tag: {
    title: 'タグマスタ',
    unit: 'タグ',
    hint: 'オブジェクトに付けるしるしです。1 つのオブジェクトに複数付けられ、オブジェクトの作成・編集画面で選びます。',
    emptyDescription: '「レア」「換金用」など、横断して目印にしたい単位で追加します。',
    placeholder: 'レア / 換金用 など',
  },
};

/**
 * カテゴリマスタとタグマスタの画面。
 * 扱う対象が違うだけで操作は同じなので、1 つのコンポーネントで両方を受け持つ。
 */
@Component({
  selector: 'app-label-list',
  imports: [
    RouterLink,
    FormField,
    Modal,
    ConfirmDialog,
    EmptyState,
    ErrorBanner,
    IconButton,
    InfoHint,
  ],
  templateUrl: './label-list.html',
})
export class LabelList {
  /** ルートパラメータ `/projects/:projectId/(categories|tags)` */
  readonly projectId = input.required<string>();
  /** ルートの `data.kind` */
  readonly kind = input.required<LabelKind>();

  private readonly projects = inject(ProjectService);
  private readonly categories = inject(CategoryService);
  private readonly tags = inject(TagService);
  private readonly router = inject(Router);

  private readonly service = computed<LabelService>(() =>
    this.kind() === 'category' ? this.categories : this.tags,
  );

  protected readonly text = computed(() => TEXTS[this.kind()]);
  protected readonly project = signal<Project | null>(null);
  protected readonly all = computed(() => this.service().all());
  protected readonly loaded = computed(() => this.service().loaded());
  protected readonly isEmpty = computed(() => this.service().isEmpty());

  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly editorOpen = signal(false);
  private readonly editingId = signal<string | null>(null);
  protected readonly editorHeading = computed(() =>
    this.editingId() ? `${this.text().unit}を編集` : `${this.text().unit}を追加`,
  );

  private readonly editorModel = signal({ name: '' });
  protected readonly editorForm = form(this.editorModel, (label) => {
    required(label.name, { message: '名前を入力してください。' });
    maxLength(label.name, 50, { message: '名前は 50 文字以内で入力してください。' });
  });
  protected readonly nameError = computed(() => firstErrorMessage(this.editorForm.name));

  protected readonly deleteOpen = signal(false);
  protected readonly deleteTarget = signal<Label | null>(null);

  constructor() {
    effect(() => {
      const id = this.projectId();
      // 種別が変わったときも読み直す
      this.kind();
      void this.load(id);
    });
  }

  protected usageFor(labelId: string): readonly LabelUsage[] {
    return this.service().usage().get(labelId) ?? [];
  }

  protected openCreate(): void {
    this.editingId.set(null);
    this.editorModel.set({ name: '' });
    this.editorForm().reset();
    this.editorOpen.set(true);
  }

  protected openEdit(target: Label): void {
    this.editingId.set(target.id);
    this.editorModel.set({ name: target.name });
    this.editorForm().reset();
    this.editorOpen.set(true);
  }

  protected async save(): Promise<void> {
    this.editorForm().markAsTouched();
    if (!this.editorForm().valid()) {
      return;
    }
    const { name } = this.editorModel();
    const id = this.editingId();
    this.busy.set(true);
    this.error.set(null);
    try {
      if (id) {
        await this.service().update(id, name);
      } else {
        await this.service().create(this.projectId(), name);
      }
      this.editorOpen.set(false);
    } catch (error) {
      this.error.set(toMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async move(target: Label, direction: -1 | 1): Promise<void> {
    this.error.set(null);
    try {
      await this.service().move(target.id, direction);
    } catch (error) {
      this.error.set(toMessage(error));
    }
  }

  protected askDelete(target: Label): void {
    this.deleteTarget.set(target);
    this.deleteOpen.set(true);
  }

  protected async confirmDelete(): Promise<void> {
    const target = this.deleteTarget();
    if (!target) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      // 使用中の場合は LabelInUseError が投げられる
      await this.service().delete(target.id);
      this.deleteTarget.set(null);
    } catch (error) {
      this.error.set(toMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  private async load(projectId: string): Promise<void> {
    try {
      const project = await this.projects.getById(projectId);
      if (!project) {
        // 存在しない ID は一覧へ戻す
        await this.router.navigate(['/']);
        return;
      }
      this.project.set(project);
      await this.service().load(projectId);
    } catch (error) {
      this.error.set(toMessage(error));
    }
  }
}
