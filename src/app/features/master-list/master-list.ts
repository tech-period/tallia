import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormField, form, maxLength, required } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { ImagePayload, Master, Project } from '../../core/db/schema';
import { toMessage } from '../../core/services/errors';
import { MasterImageService } from '../../core/services/master-image.service';
import { MasterService, MasterUsage } from '../../core/services/master.service';
import { ProjectService } from '../../core/services/project.service';
import { ConfirmDialog } from '../../shared/components/confirm-dialog';
import { EmptyState } from '../../shared/components/empty-state';
import { ErrorBanner } from '../../shared/components/error-banner';
import { IconButton } from '../../shared/components/icon-button';
import { ImagePicker } from '../../shared/components/image-picker';
import { InfoHint } from '../../shared/components/info-hint';
import { Modal } from '../../shared/components/modal';
import { firstErrorMessage, inputValue } from '../../shared/utils/form';

@Component({
  selector: 'app-master-list',
  imports: [
    RouterLink,
    FormField,
    Modal,
    ConfirmDialog,
    EmptyState,
    ErrorBanner,
    IconButton,
    ImagePicker,
    InfoHint,
  ],
  templateUrl: './master-list.html',
})
export class MasterList {
  /** ルートパラメータ `/projects/:projectId/masters` */
  readonly projectId = input.required<string>();

  private readonly projects = inject(ProjectService);
  private readonly masters = inject(MasterService);
  private readonly images = inject(MasterImageService);
  private readonly router = inject(Router);

  protected readonly project = signal<Project | null>(null);
  protected readonly loaded = this.masters.loaded;
  protected readonly isEmpty = this.masters.isEmpty;
  protected readonly imageUrls = this.images.urls;
  protected readonly categories = this.masters.categories;
  protected readonly tags = this.masters.tags;

  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly nameFilter = signal('');
  protected readonly categoryFilter = signal('');
  protected readonly tagFilter = signal('');

  /** 絞り込みは Signal の computed で行う（マスターは数百件を想定） */
  protected readonly filtered = computed<readonly Master[]>(() => {
    const keyword = this.nameFilter().trim().toLocaleLowerCase('ja');
    const category = this.categoryFilter();
    const tag = this.tagFilter();
    return this.masters.all().filter((master) => {
      if (keyword && !master.name.toLocaleLowerCase('ja').includes(keyword)) {
        return false;
      }
      if (category && master.category !== category) {
        return false;
      }
      if (tag && !master.tags.includes(tag)) {
        return false;
      }
      return true;
    });
  });
  protected readonly hasFilter = computed(
    () =>
      this.nameFilter().trim() !== '' || this.categoryFilter() !== '' || this.tagFilter() !== '',
  );
  protected readonly noMatch = computed(
    () => this.loaded() && !this.isEmpty() && this.filtered().length === 0,
  );

  protected readonly editorOpen = signal(false);
  private readonly editingId = signal<string | null>(null);
  protected readonly editorHeading = computed(() =>
    this.editingId() ? 'オブジェクトを編集' : 'オブジェクトを追加',
  );

  private readonly editorModel = signal({ name: '', category: '', tags: '', note: '' });
  protected readonly editorForm = form(this.editorModel, (master) => {
    required(master.name, { message: 'オブジェクト名を入力してください。' });
    maxLength(master.name, 100, { message: 'オブジェクト名は 100 文字以内で入力してください。' });
    maxLength(master.category, 50, { message: 'カテゴリは 50 文字以内で入力してください。' });
    maxLength(master.note, 500, { message: 'メモは 500 文字以内で入力してください。' });
  });
  protected readonly nameError = computed(() => firstErrorMessage(this.editorForm.name));
  protected readonly categoryError = computed(() => firstErrorMessage(this.editorForm.category));
  protected readonly noteError = computed(() => firstErrorMessage(this.editorForm.note));

  /** 編集中の画像。保存されるまで DB には書かない */
  protected readonly pendingImage = signal<ImagePayload | null>(null);
  /** 画像が差し替えられたかを参照の同一性で判定するための元データ */
  private readonly originalImage = signal<ImagePayload | null>(null);

  protected readonly deleteOpen = signal(false);
  protected readonly deleteTarget = signal<Master | null>(null);

  constructor() {
    effect(() => {
      const id = this.projectId();
      void this.load(id);
    });
  }

  protected imageFor(masterId: string): string | undefined {
    return this.imageUrls().get(masterId);
  }

  protected usageFor(masterId: string): readonly MasterUsage[] {
    return this.masters.usage().get(masterId) ?? [];
  }

  protected onNameFilterInput(event: Event): void {
    this.nameFilter.set(inputValue(event));
  }

  protected onCategoryFilterChange(event: Event): void {
    this.categoryFilter.set(inputValue(event));
  }

  protected onTagFilterChange(event: Event): void {
    this.tagFilter.set(inputValue(event));
  }

  protected clearFilters(): void {
    this.nameFilter.set('');
    this.categoryFilter.set('');
    this.tagFilter.set('');
  }

  protected openCreate(): void {
    this.editingId.set(null);
    this.editorModel.set({ name: '', category: '', tags: '', note: '' });
    this.editorForm().reset();
    this.setImage(null);
    this.editorOpen.set(true);
  }

  protected async openEdit(master: Master): Promise<void> {
    this.editingId.set(master.id);
    this.editorModel.set({
      name: master.name,
      category: master.category ?? '',
      tags: master.tags.join(', '),
      note: master.note ?? '',
    });
    this.editorForm().reset();
    this.setImage(null);
    this.editorOpen.set(true);
    this.error.set(null);
    try {
      this.setImage(await this.images.get(master.id));
    } catch (error) {
      this.error.set(toMessage(error));
    }
  }

  protected async save(): Promise<void> {
    this.editorForm().markAsTouched();
    if (!this.editorForm().valid()) {
      return;
    }
    const { name, category, tags, note } = this.editorModel();
    const parsedTags = tags
      .split(/[,、]/)
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
    const id = this.editingId();
    this.busy.set(true);
    this.error.set(null);
    try {
      const saved = id
        ? await this.masters.update(id, { name, category, tags: parsedTags, note })
        : await this.masters.create(this.projectId(), {
            name,
            category,
            tags: parsedTags,
            note,
          });
      await this.applyImage(saved.id);
      this.editorOpen.set(false);
    } catch (error) {
      this.error.set(toMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected askDelete(master: Master): void {
    this.deleteTarget.set(master);
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
      // 使用中の場合は MasterInUseError が投げられる
      await this.masters.delete(target.id);
      this.deleteTarget.set(null);
    } catch (error) {
      this.error.set(toMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  /** 画像は差し替えがあったときだけ書き込む */
  private async applyImage(masterId: string): Promise<void> {
    const next = this.pendingImage();
    if (next === this.originalImage()) {
      return;
    }
    if (next) {
      await this.images.save(masterId, this.projectId(), next);
    } else {
      await this.images.remove(masterId);
    }
    this.setImage(next);
  }

  private setImage(image: ImagePayload | null): void {
    this.pendingImage.set(image);
    this.originalImage.set(image);
  }

  private async load(projectId: string): Promise<void> {
    try {
      const project = await this.projects.getById(projectId);
      if (!project) {
        await this.router.navigate(['/']);
        return;
      }
      this.project.set(project);
      await this.masters.load(projectId);
      await this.images.loadByProject(projectId);
    } catch (error) {
      this.error.set(toMessage(error));
    }
  }
}
