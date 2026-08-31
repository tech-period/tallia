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
import { IconButton } from '../../shared/components/icon-button';
import { InfoHint } from '../../shared/components/info-hint';
import { Modal } from '../../shared/components/modal';
import { firstErrorMessage, inputValue } from '../../shared/utils/form';

@Component({
  selector: 'app-case-overview',
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
  templateUrl: './case-overview.html',
})
export class CaseOverview {
  /** ルートパラメータ `/projects/:projectId/overview` */
  readonly projectId = input.required<string>();
  /** クエリパラメータ `?open=<caseId>`。指定されたケースを開いた状態で表示する */
  readonly open = input<string>();

  private readonly projects = inject(ProjectService);
  private readonly cases = inject(CaseService);
  private readonly masters = inject(MasterService);
  private readonly instances = inject(InstanceService);
  private readonly images = inject(MasterImageService);
  private readonly router = inject(Router);

  protected readonly project = signal<Project | null>(null);
  protected readonly all = this.cases.all;
  protected readonly loaded = this.cases.loaded;
  protected readonly isEmpty = this.cases.isEmpty;
  protected readonly availableMasters = this.masters.all;
  protected readonly imageUrls = this.images.urls;

  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  /** 展開中のケース ID */
  private readonly expandedIds = signal<ReadonlySet<string>>(new Set());
  /** 読み込み済みのケースの中身。展開されるまで読まない */
  private readonly rowsByCase = signal<ReadonlyMap<string, readonly InstanceRow[]>>(new Map());
  /** 初回読み込み中のケース ID */
  private readonly pendingIds = signal<ReadonlySet<string>>(new Set());

  protected readonly addOpen = signal(false);
  private readonly addTarget = signal<Case | null>(null);
  protected readonly addHeading = computed(
    () => `「${this.addTarget()?.name ?? ''}」にオブジェクトを追加`,
  );
  private readonly addModel = signal({ masterId: '', qty: 1 });
  protected readonly addForm = form(this.addModel, (entry) => {
    required(entry.masterId, { message: '追加するオブジェクトを選んでください。' });
    min(entry.qty, 0, { message: '個数は 0 以上を指定してください。' });
  });
  protected readonly masterIdError = computed(() => firstErrorMessage(this.addForm.masterId));
  protected readonly qtyError = computed(() => firstErrorMessage(this.addForm.qty));

  protected readonly deleteOpen = signal(false);
  protected readonly deleteTarget = signal<InstanceRow | null>(null);

  constructor() {
    effect(() => {
      const id = this.projectId();
      const open = this.open();
      void this.load(id, open);
    });
  }

  protected panelId(caseId: string): string {
    return `case-panel-${caseId}`;
  }

  protected isExpanded(caseId: string): boolean {
    return this.expandedIds().has(caseId);
  }

  protected isPending(caseId: string): boolean {
    return this.pendingIds().has(caseId);
  }

  protected rowsFor(caseId: string): readonly InstanceRow[] | undefined {
    return this.rowsByCase().get(caseId);
  }

  /** 読み込み済みなら手元の行から数え、まだなら読み込み時の合計を使う */
  protected totalFor(caseId: string): number {
    const rows = this.rowsByCase().get(caseId);
    if (rows) {
      return rows.reduce((sum, row) => sum + row.instance.qty, 0);
    }
    return this.cases.totals().get(caseId) ?? 0;
  }

  protected imageFor(masterId: string): string | undefined {
    return this.imageUrls().get(masterId);
  }

  protected masterName(master: Master): string {
    return master.category ? `${master.name}（${master.category}）` : master.name;
  }

  protected toggle(target: Case): void {
    const next = new Set(this.expandedIds());
    if (next.delete(target.id)) {
      this.expandedIds.set(next);
      return;
    }
    next.add(target.id);
    this.expandedIds.set(next);
    if (!this.rowsByCase().has(target.id)) {
      void this.loadRows(target.id);
    }
  }

  protected async changeQty(row: InstanceRow, delta: number): Promise<void> {
    this.error.set(null);
    try {
      await this.instances.addToCase(row.instance.caseId, row.instance.masterId, delta);
      await this.fetchRows(row.instance.caseId);
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
      await this.fetchRows(row.instance.caseId);
    } catch (error) {
      this.error.set(toMessage(error));
    }
  }

  protected openAdd(target: Case): void {
    this.addTarget.set(target);
    this.addModel.set({ masterId: '', qty: 1 });
    this.addForm().reset();
    this.addOpen.set(true);
  }

  protected async add(): Promise<void> {
    const target = this.addTarget();
    this.addForm().markAsTouched();
    if (!target || !this.addForm().valid()) {
      return;
    }
    const { masterId, qty } = this.addModel();
    this.busy.set(true);
    this.error.set(null);
    try {
      // 既存分があれば新規作成せず qty に加算される
      await this.instances.addToCase(target.id, masterId, qty);
      await this.fetchRows(target.id);
      this.addOpen.set(false);
    } catch (error) {
      this.error.set(toMessage(error));
    } finally {
      this.busy.set(false);
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
      await this.fetchRows(target.instance.caseId);
      this.deleteTarget.set(null);
    } catch (error) {
      this.error.set(toMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  /** 初回の展開時だけ「読み込み中」を出す */
  private async loadRows(caseId: string): Promise<void> {
    this.pendingIds.update((ids) => new Set(ids).add(caseId));
    try {
      await this.fetchRows(caseId);
    } catch (error) {
      this.error.set(toMessage(error));
      // 読めなかったケースは畳んで、次に開いたときに読み直せるようにする
      this.expandedIds.update((ids) => {
        const next = new Set(ids);
        next.delete(caseId);
        return next;
      });
    } finally {
      this.pendingIds.update((ids) => {
        const next = new Set(ids);
        next.delete(caseId);
        return next;
      });
    }
  }

  /** 展開されたケースの中身だけを `by-case` インデックスで読み直す */
  private async fetchRows(caseId: string): Promise<void> {
    const rows = await this.instances.rowsForCase(caseId, this.projectId());
    this.rowsByCase.update((map) => new Map(map).set(caseId, rows));
  }

  private async load(projectId: string, open: string | undefined): Promise<void> {
    this.expandedIds.set(new Set());
    this.rowsByCase.set(new Map());
    try {
      const project = await this.projects.getById(projectId);
      if (!project) {
        // 存在しない ID は一覧へ戻す
        await this.router.navigate(['/']);
        return;
      }
      this.project.set(project);
      await Promise.all([
        this.cases.load(projectId),
        this.masters.load(projectId),
        // サムネイルも `by-project` インデックスで表示中プロジェクト分だけ読む
        this.images.loadByProject(projectId),
      ]);
      // 「使用中のケース」から飛んできた場合は、そのケースを開いた状態にする
      if (open && this.cases.all().some((item) => item.id === open)) {
        this.expandedIds.set(new Set([open]));
        await this.loadRows(open);
      }
    } catch (error) {
      this.error.set(toMessage(error));
    }
  }
}
