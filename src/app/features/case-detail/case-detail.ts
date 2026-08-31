import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormField, form, min, required } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import { Case, Master, Project } from '../../core/db/schema';
import { CaseService } from '../../core/services/case.service';
import { toMessage } from '../../core/services/errors';
import { InstanceRow, InstanceService } from '../../core/services/instance.service';
import { MasterImageService } from '../../core/services/master-image.service';
import { MasterService } from '../../core/services/master.service';
import { ProjectService } from '../../core/services/project.service';
import { ConfirmDialog } from '../../shared/components/confirm-dialog';
import { EmptyState } from '../../shared/components/empty-state';
import { ErrorBanner } from '../../shared/components/error-banner';
import { InfoHint } from '../../shared/components/info-hint';
import { Modal } from '../../shared/components/modal';
import { firstErrorMessage, inputValue } from '../../shared/utils/form';

@Component({
  selector: 'app-case-detail',
  imports: [RouterLink, FormField, Modal, ConfirmDialog, EmptyState, ErrorBanner, InfoHint],
  templateUrl: './case-detail.html',
})
export class CaseDetail {
  /** ルートパラメータ `/projects/:projectId/cases/:caseId` */
  readonly projectId = input.required<string>();
  readonly caseId = input.required<string>();

  private readonly projects = inject(ProjectService);
  private readonly cases = inject(CaseService);
  private readonly masters = inject(MasterService);
  private readonly instances = inject(InstanceService);
  private readonly images = inject(MasterImageService);
  private readonly router = inject(Router);

  protected readonly project = signal<Project | null>(null);
  protected readonly current = signal<Case | null>(null);
  protected readonly loaded = this.instances.loaded;
  protected readonly totalQty = this.instances.totalQty;
  protected readonly availableMasters = this.masters.all;
  protected readonly imageUrls = this.images.urls;

  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly filter = signal('');
  protected readonly rows = computed<readonly InstanceRow[]>(() => {
    const keyword = this.filter().trim().toLocaleLowerCase('ja');
    const rows = this.instances.rows();
    if (!keyword) {
      return rows;
    }
    return rows.filter((row) => row.masterName.toLocaleLowerCase('ja').includes(keyword));
  });
  protected readonly isEmpty = computed(() => this.loaded() && this.instances.rows().length === 0);
  protected readonly noMatch = computed(
    () => this.loaded() && this.instances.rows().length > 0 && this.rows().length === 0,
  );

  protected readonly addOpen = signal(false);
  private readonly addModel = signal({ masterId: '', qty: 1 });
  protected readonly addForm = form(this.addModel, (entry) => {
    required(entry.masterId, { message: '追加するオブジェクトを選んでください。' });
    min(entry.qty, 1, { message: '個数は 1 以上を指定してください。' });
  });
  protected readonly masterIdError = computed(() => firstErrorMessage(this.addForm.masterId));
  protected readonly qtyError = computed(() => firstErrorMessage(this.addForm.qty));

  protected readonly deleteOpen = signal(false);
  protected readonly deleteTarget = signal<InstanceRow | null>(null);

  constructor() {
    effect(() => {
      const projectId = this.projectId();
      const caseId = this.caseId();
      void this.load(projectId, caseId);
    });
  }

  protected imageFor(masterId: string): string | undefined {
    return this.imageUrls().get(masterId);
  }

  protected onFilterInput(event: Event): void {
    this.filter.set(inputValue(event));
  }

  protected openAdd(): void {
    this.addModel.set({ masterId: '', qty: 1 });
    this.addForm().reset();
    this.addOpen.set(true);
  }

  protected async add(): Promise<void> {
    this.addForm().markAsTouched();
    if (!this.addForm().valid()) {
      return;
    }
    const { masterId, qty } = this.addModel();
    this.busy.set(true);
    this.error.set(null);
    try {
      // 既存分があれば新規作成せず qty に加算される
      await this.instances.addToCase(this.caseId(), masterId, qty);
      this.addOpen.set(false);
    } catch (error) {
      this.error.set(toMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async changeQty(row: InstanceRow, delta: number): Promise<void> {
    this.error.set(null);
    try {
      await this.instances.addToCase(row.instance.caseId, row.instance.masterId, delta);
    } catch (error) {
      this.error.set(toMessage(error));
    }
  }

  protected async setQty(row: InstanceRow, event: Event): Promise<void> {
    const value = Number.parseInt(inputValue(event), 10);
    if (!Number.isFinite(value)) {
      return;
    }
    this.error.set(null);
    try {
      await this.instances.setQty(row.instance.id, value);
    } catch (error) {
      this.error.set(toMessage(error));
    }
  }

  protected askDelete(row: InstanceRow): void {
    this.deleteTarget.set(row);
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
      await this.instances.delete(target.instance.id);
      this.deleteTarget.set(null);
    } catch (error) {
      this.error.set(toMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected masterName(master: Master): string {
    return master.category ? `${master.name}（${master.category}）` : master.name;
  }

  private async load(projectId: string, caseId: string): Promise<void> {
    try {
      const [project, target] = await Promise.all([
        this.projects.getById(projectId),
        this.cases.getById(caseId),
      ]);
      if (!project) {
        await this.router.navigate(['/']);
        return;
      }
      if (!target || target.projectId !== projectId) {
        // 存在しない ID はケース一覧へ戻す
        await this.router.navigate(['/projects', projectId]);
        return;
      }
      this.project.set(project);
      this.current.set(target);
      await Promise.all([
        this.masters.load(projectId),
        this.instances.load(caseId, projectId),
        // 画像も `by-project` インデックスで表示中プロジェクト分だけ読む
        this.images.loadByProject(projectId),
      ]);
    } catch (error) {
      this.error.set(toMessage(error));
    }
  }
}
