import { Component, computed, inject, signal } from '@angular/core';
import { MASTER_FILE_EXTENSION, BackupFile, MasterFile, Project } from '../../core/db/schema';
import { BackupService, ImportMode, ImportResult } from '../../core/services/backup.service';
import { toMessage } from '../../core/services/errors';
import {
  MasterCounts,
  MasterImportMode,
  MasterImportPreview,
  MasterImportResult,
  MasterTransferService,
  total,
} from '../../core/services/master-transfer.service';
import { ProjectService } from '../../core/services/project.service';
import { StorageService } from '../../core/services/storage.service';
import { ConfirmDialog } from '../../shared/components/confirm-dialog';
import { ErrorBanner } from '../../shared/components/error-banner';
import { InfoHint } from '../../shared/components/info-hint';
import { Modal } from '../../shared/components/modal';
import { inputValue } from '../../shared/utils/form';

@Component({
  selector: 'app-settings',
  imports: [Modal, ConfirmDialog, ErrorBanner, InfoHint],
  templateUrl: './settings.html',
})
export class Settings {
  private readonly backup = inject(BackupService);
  private readonly transfer = inject(MasterTransferService);
  private readonly projects = inject(ProjectService);
  private readonly storage = inject(StorageService);

  protected readonly allProjects = this.projects.all;
  protected readonly persisted = this.storage.persisted;
  protected readonly estimate = this.storage.estimate;
  protected readonly indexedDbAvailable = this.storage.indexedDbAvailable;

  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly exportProjectId = signal('');

  /** 選択されたファイルを読み込んで検証したもの */
  protected readonly pendingBackup = signal<BackupFile | null>(null);
  protected readonly pendingFileName = signal('');
  protected readonly importMode = signal<ImportMode>('append');

  protected readonly pendingSummary = computed(() => {
    const file = this.pendingBackup();
    if (!file) {
      return null;
    }
    return {
      projects: file.projects.length,
      cases: file.cases.length,
      masters: file.masters.length,
      instances: file.instances.length,
      // プロジェクトとオブジェクトの画像は合算して見せる
      images: (file.images?.length ?? 0) + (file.masterImages?.length ?? 0),
      exportedAt: file.exportedAt,
    };
  });

  /* --- マスタの移し替え（マスタ 4 種をプロジェクト間で持ち運ぶ） --- */

  protected readonly fileExtension = MASTER_FILE_EXTENSION;
  /** 書き出し元と取り込み先。どちらもプロジェクトを選ばせる */
  protected readonly transferExportProjectId = signal('');
  protected readonly transferImportProjectId = signal('');
  /** 選択されたファイルを検証したものと、取り込んだ場合の見積もり */
  protected readonly transferFile = signal<MasterFile | null>(null);
  protected readonly transferFileName = signal('');
  protected readonly transferPreview = signal<MasterImportPreview | null>(null);
  protected readonly transferMode = signal<MasterImportMode>('skip');
  protected readonly transferOverwriteOpen = signal(false);
  /** 取り込み先を選び直したら見積もりを取り直す必要がある */
  protected readonly transferReady = computed(
    () => this.transferFile() !== null && this.transferPreview() !== null,
  );
  /** 同名が 1 件も無ければ、取り込み方を選ばせる意味がない */
  protected readonly transferHasExisting = computed(() => {
    const preview = this.transferPreview();
    return preview !== null && total(preview.existing) > 0;
  });

  /** 置換インポートの二段階確認 */
  protected readonly replaceStep1Open = signal(false);
  protected readonly replaceStep2Open = signal(false);
  protected readonly replaceConfirmText = signal('');
  protected readonly replaceConfirmed = computed(() => this.replaceConfirmText().trim() === '置換');

  /** 全データ削除の二段階確認 */
  protected readonly wipeStep1Open = signal(false);
  protected readonly wipeStep2Open = signal(false);
  protected readonly wipeConfirmText = signal('');
  protected readonly wipeConfirmed = computed(() => this.wipeConfirmText().trim() === '削除');

  protected readonly usageLabel = computed(() => {
    const estimate = this.estimate();
    if (!estimate || estimate.usageBytes === null) {
      return null;
    }
    const used = formatBytes(estimate.usageBytes);
    if (estimate.quotaBytes === null) {
      return `${used} を使用中`;
    }
    const percent =
      estimate.quotaBytes > 0
        ? Math.round((estimate.usageBytes / estimate.quotaBytes) * 1000) / 10
        : 0;
    return `${used} / ${formatBytes(estimate.quotaBytes)}（${percent}%）`;
  });

  protected readonly persistenceLabel = computed(() => {
    const persisted = this.persisted();
    if (persisted === null) {
      return '不明';
    }
    return persisted ? '有効' : '無効';
  });

  constructor() {
    void this.refresh();
  }

  protected onExportProjectChange(event: Event): void {
    this.exportProjectId.set(inputValue(event));
  }

  protected onReplaceConfirmInput(event: Event): void {
    this.replaceConfirmText.set(inputValue(event));
  }

  protected onWipeConfirmInput(event: Event): void {
    this.wipeConfirmText.set(inputValue(event));
  }

  protected async exportAll(): Promise<void> {
    this.reset();
    try {
      const file = await this.backup.exportAll();
      this.backup.download(file, this.backup.fileName());
      this.notice.set('全プロジェクトを書き出しました。');
    } catch (error) {
      this.error.set(toMessage(error));
    }
  }

  protected async exportOne(): Promise<void> {
    const projectId = this.exportProjectId();
    if (!projectId) {
      this.error.set('書き出すプロジェクトを選んでください。');
      return;
    }
    this.reset();
    try {
      const project = this.allProjects().find((p: Project) => p.id === projectId);
      const file = await this.backup.exportProject(projectId);
      this.backup.download(file, this.backup.fileName(project?.name));
      this.notice.set(`「${project?.name ?? ''}」を書き出しました。`);
    } catch (error) {
      this.error.set(toMessage(error));
    }
  }

  protected async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    this.reset();
    this.pendingBackup.set(null);
    try {
      const text = await file.text();
      this.pendingBackup.set(this.backup.parse(text));
      this.pendingFileName.set(file.name);
    } catch (error) {
      this.error.set(toMessage(error));
    } finally {
      // 同じファイルを選び直せるように値をクリアする
      input.value = '';
    }
  }

  protected startImport(): void {
    if (!this.pendingBackup()) {
      return;
    }
    if (this.importMode() === 'replace') {
      this.replaceConfirmText.set('');
      this.replaceStep1Open.set(true);
      return;
    }
    void this.runImport('append');
  }

  protected openReplaceStep2(): void {
    this.replaceConfirmText.set('');
    this.replaceStep2Open.set(true);
  }

  protected confirmReplace(): void {
    if (!this.replaceConfirmed()) {
      return;
    }
    this.replaceStep2Open.set(false);
    void this.runImport('replace');
  }

  protected openWipeStep2(): void {
    this.wipeConfirmText.set('');
    this.wipeStep2Open.set(true);
  }

  protected async confirmWipe(): Promise<void> {
    if (!this.wipeConfirmed()) {
      return;
    }
    this.wipeStep2Open.set(false);
    this.reset();
    this.busy.set(true);
    try {
      await this.backup.deleteEverything();
      await this.refresh();
      this.notice.set('すべてのデータを削除しました。');
    } catch (error) {
      this.error.set(toMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected setImportMode(mode: ImportMode): void {
    this.importMode.set(mode);
  }

  private async runImport(mode: ImportMode): Promise<void> {
    const file = this.pendingBackup();
    if (!file) {
      return;
    }
    this.reset();
    this.busy.set(true);
    try {
      const result = await this.backup.import(file, mode);
      this.pendingBackup.set(null);
      this.pendingFileName.set('');
      await this.refresh();
      this.notice.set(this.importedMessage(mode, result));
    } catch (error) {
      this.error.set(toMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  /* --- マスタの移し替え --- */

  protected onTransferExportProjectChange(event: Event): void {
    this.transferExportProjectId.set(inputValue(event));
  }

  /** 取り込み先が変われば、既に選ばれているファイルの見積もりを取り直す */
  protected async onTransferImportProjectChange(event: Event): Promise<void> {
    this.transferImportProjectId.set(inputValue(event));
    await this.refreshTransferPreview();
  }

  protected async exportMasters(): Promise<void> {
    const projectId = this.transferExportProjectId();
    if (!projectId) {
      this.error.set('書き出すプロジェクトを選んでください。');
      return;
    }
    this.reset();
    try {
      const project = this.allProjects().find((p: Project) => p.id === projectId);
      const file = await this.transfer.exportProject(projectId);
      this.transfer.download(file, this.transfer.fileName(project?.name ?? ''));
      this.notice.set(`「${project?.name ?? ''}」のマスタを書き出しました。`);
    } catch (error) {
      this.error.set(toMessage(error));
    }
  }

  /** 選んだファイルを検証する。見積もりは取り込み先が決まってから出す */
  protected async onTransferFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    this.reset();
    this.clearTransferFile();
    try {
      this.transferFile.set(this.transfer.parse(await file.text()));
      this.transferFileName.set(file.name);
      await this.refreshTransferPreview();
    } catch (error) {
      this.error.set(toMessage(error));
    } finally {
      // 同じファイルを選び直せるように値をクリアする
      input.value = '';
    }
  }

  protected setTransferMode(mode: MasterImportMode): void {
    this.transferMode.set(mode);
  }

  /** 上書きで実際に置き換わるものがあるときだけ確認を挟む */
  protected startTransferImport(): void {
    if (!this.transferReady()) {
      return;
    }
    const mode = this.transferMode();
    if (mode === 'overwrite' && this.transferHasExisting()) {
      this.transferOverwriteOpen.set(true);
      return;
    }
    void this.runTransferImport(mode);
  }

  protected confirmTransferOverwrite(): void {
    void this.runTransferImport('overwrite');
  }

  private async refreshTransferPreview(): Promise<void> {
    const file = this.transferFile();
    const projectId = this.transferImportProjectId();
    if (!file || !projectId) {
      this.transferPreview.set(null);
      return;
    }
    this.transferPreview.set(await this.transfer.preview(projectId, file));
  }

  private async runTransferImport(mode: MasterImportMode): Promise<void> {
    const file = this.transferFile();
    const projectId = this.transferImportProjectId();
    if (!file || !projectId) {
      return;
    }
    this.reset();
    this.busy.set(true);
    try {
      const result = await this.transfer.import(projectId, file, mode);
      this.clearTransferFile();
      await this.refresh();
      this.notice.set(transferredMessage(result));
    } catch (error) {
      this.error.set(toMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  private clearTransferFile(): void {
    this.transferFile.set(null);
    this.transferFileName.set('');
    this.transferPreview.set(null);
  }

  private importedMessage(mode: ImportMode, result: ImportResult): string {
    const label = mode === 'append' ? '追加' : '置換';
    return (
      `${label}で取り込みました（プロジェクト ${result.projects} / ケース ${result.cases} / ` +
      `オブジェクト ${result.masters} / 記録 ${result.instances} / ` +
      `画像 ${result.images + result.masterImages}）。`
    );
  }

  private reset(): void {
    this.error.set(null);
    this.notice.set(null);
  }

  private async refresh(): Promise<void> {
    try {
      await Promise.all([this.projects.load(), this.storage.refreshEstimate()]);
    } catch (error) {
      this.error.set(toMessage(error));
    }
  }
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${Math.round(value * 10) / 10} ${units[unit]}`;
}

/** 取り込み結果を利用者向けの 1 行にする。0 件の内訳は出さない */
function transferredMessage(result: MasterImportResult): string {
  const parts: string[] = [`追加 ${breakdown(result.added)}`];
  if (total(result.updated) > 0) {
    parts.push(`上書き ${breakdown(result.updated)}`);
  }
  if (total(result.skipped) > 0) {
    parts.push(`同名のため見送り ${total(result.skipped)} 件`);
  }
  if (result.images > 0) {
    parts.push(`画像 ${result.images} 枚`);
  }
  return `マスタを取り込みました（${parts.join(' / ')}）。`;
}

/** 「12 件（ケース 3・オブジェクト 9）」のように内訳を添える */
function breakdown(counts: MasterCounts): string {
  const labels: [string, number][] = [
    ['ケース', counts.cases],
    ['カテゴリ', counts.categories],
    ['タグ', counts.tags],
    ['オブジェクト', counts.masters],
  ];
  const detail = labels
    .filter(([, count]) => count > 0)
    .map(([name, count]) => `${name} ${count}`)
    .join('・');
  return detail ? `${total(counts)} 件（${detail}）` : '0 件';
}
