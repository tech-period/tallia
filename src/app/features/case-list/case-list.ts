import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormField, form, maxLength, required } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { Case, Project } from '../../core/db/schema';
import { CaseService } from '../../core/services/case.service';
import { toMessage } from '../../core/services/errors';
import { ProjectService } from '../../core/services/project.service';
import { ConfirmDialog } from '../../shared/components/confirm-dialog';
import { EmptyState } from '../../shared/components/empty-state';
import { ErrorBanner } from '../../shared/components/error-banner';
import { InfoHint } from '../../shared/components/info-hint';
import { Modal } from '../../shared/components/modal';
import { firstErrorMessage } from '../../shared/utils/form';

@Component({
  selector: 'app-case-list',
  imports: [RouterLink, FormField, Modal, ConfirmDialog, EmptyState, ErrorBanner, InfoHint],
  templateUrl: './case-list.html',
})
export class CaseList {
  /** ルートパラメータ `/projects/:projectId/cases` */
  readonly projectId = input.required<string>();

  private readonly projects = inject(ProjectService);
  private readonly cases = inject(CaseService);
  private readonly router = inject(Router);

  protected readonly project = signal<Project | null>(null);
  protected readonly all = this.cases.all;
  protected readonly totals = this.cases.totals;
  protected readonly loaded = this.cases.loaded;
  protected readonly isEmpty = this.cases.isEmpty;

  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly editorOpen = signal(false);
  private readonly editingId = signal<string | null>(null);
  protected readonly editorHeading = computed(() =>
    this.editingId() ? 'ケースを編集' : 'ケースを追加',
  );

  private readonly editorModel = signal({ name: '', note: '' });
  protected readonly editorForm = form(this.editorModel, (c) => {
    required(c.name, { message: 'ケース名を入力してください。' });
    maxLength(c.name, 100, { message: 'ケース名は 100 文字以内で入力してください。' });
    maxLength(c.note, 500, { message: 'メモは 500 文字以内で入力してください。' });
  });
  protected readonly nameError = computed(() => firstErrorMessage(this.editorForm.name));
  protected readonly noteError = computed(() => firstErrorMessage(this.editorForm.note));

  protected readonly deleteOpen = signal(false);
  protected readonly deleteTarget = signal<Case | null>(null);
  protected readonly deleteDetails = signal<readonly string[]>([]);

  constructor() {
    effect(() => {
      const id = this.projectId();
      void this.load(id);
    });
  }

  protected totalFor(caseId: string): number {
    return this.totals().get(caseId) ?? 0;
  }

  protected openCreate(): void {
    this.editingId.set(null);
    this.editorModel.set({ name: '', note: '' });
    this.editorForm().reset();
    this.editorOpen.set(true);
  }

  protected openEdit(target: Case): void {
    this.editingId.set(target.id);
    this.editorModel.set({ name: target.name, note: target.note ?? '' });
    this.editorForm().reset();
    this.editorOpen.set(true);
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
      if (id) {
        await this.cases.update(id, { name, note });
      } else {
        await this.cases.create(this.projectId(), name, note);
      }
      this.editorOpen.set(false);
    } catch (error) {
      this.error.set(toMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async move(target: Case, direction: -1 | 1): Promise<void> {
    this.error.set(null);
    try {
      await this.cases.move(target.id, direction);
    } catch (error) {
      this.error.set(toMessage(error));
    }
  }

  protected async askDelete(target: Case): Promise<void> {
    this.error.set(null);
    try {
      const count = await this.cases.countInstances(target.id);
      this.deleteTarget.set(target);
      this.deleteDetails.set([`このケースに記録された ${count} 件のオブジェクト`]);
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
      await this.cases.delete(target.id);
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
      await this.cases.load(projectId);
    } catch (error) {
      this.error.set(toMessage(error));
    }
  }
}
