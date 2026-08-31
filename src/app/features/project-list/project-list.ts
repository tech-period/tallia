import { Component, computed, inject, signal } from '@angular/core';
import { FormField, form, maxLength, required } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import { ImagePayload, Project } from '../../core/db/schema';
import { toMessage } from '../../core/services/errors';
import { ProjectImageService } from '../../core/services/project-image.service';
import { ProjectService } from '../../core/services/project.service';
import { ConfirmDialog } from '../../shared/components/confirm-dialog';
import { EmptyState } from '../../shared/components/empty-state';
import { ErrorBanner } from '../../shared/components/error-banner';
import { IconButton } from '../../shared/components/icon-button';
import { ImagePicker } from '../../shared/components/image-picker';
import { InfoHint } from '../../shared/components/info-hint';
import { Modal } from '../../shared/components/modal';
import { firstErrorMessage } from '../../shared/utils/form';

@Component({
  selector: 'app-project-list',
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
  templateUrl: './project-list.html',
})
export class ProjectList {
  private readonly projects = inject(ProjectService);
  private readonly images = inject(ProjectImageService);

  protected readonly all = this.projects.all;
  protected readonly stats = this.projects.stats;
  protected readonly loaded = this.projects.loaded;
  protected readonly isEmpty = this.projects.isEmpty;
  protected readonly imageUrls = this.images.urls;

  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly editorOpen = signal(false);
  private readonly editingId = signal<string | null>(null);
  protected readonly editorHeading = computed(() =>
    this.editingId() ? 'プロジェクトを編集' : 'プロジェクトを作成',
  );

  private readonly editorModel = signal({ name: '', note: '' });
  protected readonly editorForm = form(this.editorModel, (project) => {
    required(project.name, { message: 'プロジェクト名を入力してください。' });
    maxLength(project.name, 100, { message: 'プロジェクト名は 100 文字以内で入力してください。' });
    maxLength(project.note, 500, { message: 'メモは 500 文字以内で入力してください。' });
  });
  protected readonly nameError = computed(() => firstErrorMessage(this.editorForm.name));
  protected readonly noteError = computed(() => firstErrorMessage(this.editorForm.note));

  /** 編集中の画像。保存されるまで DB には書かない */
  protected readonly pendingImage = signal<ImagePayload | null>(null);
  /** 画像が差し替えられたかを参照の同一性で判定するための元データ */
  private readonly originalImage = signal<ImagePayload | null>(null);

  protected readonly deleteOpen = signal(false);
  protected readonly deleteTarget = signal<Project | null>(null);
  protected readonly deleteDetails = signal<readonly string[]>([]);

  constructor() {
    void this.reload();
  }

  protected statsFor(projectId: string): { caseCount: number; masterCount: number } {
    return this.stats().get(projectId) ?? { caseCount: 0, masterCount: 0 };
  }

  protected imageFor(projectId: string): string | undefined {
    return this.imageUrls().get(projectId);
  }

  protected openCreate(): void {
    this.editingId.set(null);
    this.editorModel.set({ name: '', note: '' });
    this.editorForm().reset();
    this.setImage(null);
    this.editorOpen.set(true);
  }

  protected async openEdit(project: Project): Promise<void> {
    this.editingId.set(project.id);
    this.editorModel.set({ name: project.name, note: project.note ?? '' });
    this.editorForm().reset();
    this.setImage(null);
    this.editorOpen.set(true);
    this.error.set(null);
    try {
      this.setImage(await this.images.get(project.id));
    } catch (error) {
      this.error.set(toMessage(error));
    }
  }

  protected async save(): Promise<void> {
    this.editorForm().markAsTouched();
    if (!this.editorForm().valid()) {
      return;
    }
    const { name, note } = this.editorModel();
    const id = this.editingId();
    this.busy.set(true);
    this.error.set(null);
    try {
      const saved = id
        ? await this.projects.update(id, { name, note })
        : await this.projects.create(name, note);
      await this.applyImage(saved.id);
      this.editorOpen.set(false);
    } catch (error) {
      this.error.set(toMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async askDelete(project: Project): Promise<void> {
    this.error.set(null);
    try {
      const counts = await this.projects.countDescendants(project.id);
      this.deleteTarget.set(project);
      this.deleteDetails.set([
        `ケース ${counts.cases} 件`,
        `オブジェクト ${counts.masters} 件`,
        `記録 ${counts.instances} 件`,
      ]);
      this.deleteOpen.set(true);
    } catch (error) {
      this.error.set(toMessage(error));
    }
  }

  protected async confirmDelete(): Promise<void> {
    const target = this.deleteTarget();
    if (!target) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.projects.delete(target.id);
      this.deleteTarget.set(null);
    } catch (error) {
      this.error.set(toMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  /** 画像は差し替えがあったときだけ書き込む */
  private async applyImage(projectId: string): Promise<void> {
    const next = this.pendingImage();
    if (next === this.originalImage()) {
      return;
    }
    if (next) {
      await this.images.save(projectId, next);
    } else {
      await this.images.remove(projectId);
    }
    this.setImage(next);
  }

  private setImage(image: ImagePayload | null): void {
    this.pendingImage.set(image);
    this.originalImage.set(image);
  }

  private async reload(): Promise<void> {
    try {
      await this.projects.load();
    } catch (error) {
      this.error.set(toMessage(error));
    }
  }
}
