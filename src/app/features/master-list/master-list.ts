import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormField, form, maxLength, required } from '@angular/forms/signals';
import { Router, RouterLink } from '@angular/router';
import {
  MASTER_FILE_EXTENSION,
  ImagePayload,
  Master,
  MasterFile,
  Project,
} from '../../core/db/schema';
import { CategoryService } from '../../core/services/category.service';
import { toMessage } from '../../core/services/errors';
import { MasterImageService } from '../../core/services/master-image.service';
import {
  MasterImportMode,
  MasterImportPreview,
  MasterImportResult,
  MasterTransferService,
} from '../../core/services/master-transfer.service';
import { MasterService, MasterUsage } from '../../core/services/master.service';
import { ProjectService } from '../../core/services/project.service';
import { TagService } from '../../core/services/tag.service';
import { ConfirmDialog } from '../../shared/components/confirm-dialog';
import { EmptyState } from '../../shared/components/empty-state';
import { ErrorBanner } from '../../shared/components/error-banner';
import { IconButton } from '../../shared/components/icon-button';
import { ImagePicker } from '../../shared/components/image-picker';
import { InfoHint } from '../../shared/components/info-hint';
import { Modal } from '../../shared/components/modal';
import { firstErrorMessage, inputValue } from '../../shared/utils/form';

/** 絞り込み条件の種類。閉じている間のチップと解除操作で使う */
type FilterKind = 'name' | 'category' | 'tag';

interface FilterChip {
  readonly kind: FilterKind;
  readonly text: string;
}

/** 一覧の並び順。`MasterService.all` が名前順なので `name` が既定 */
const SORT_OPTIONS = [
  { key: 'name', label: '名前順' },
  { key: 'created-desc', label: '追加が新しい順' },
  { key: 'usage-desc', label: '使用ケースが多い順' },
] as const;
type SortKey = (typeof SORT_OPTIONS)[number]['key'];

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
  private readonly categoryMaster = inject(CategoryService);
  private readonly tagMaster = inject(TagService);
  private readonly images = inject(MasterImageService);
  private readonly transfer = inject(MasterTransferService);
  private readonly router = inject(Router);

  protected readonly project = signal<Project | null>(null);
  protected readonly loaded = this.masters.loaded;
  protected readonly isEmpty = this.masters.isEmpty;
  protected readonly imageUrls = this.images.urls;
  /** 選択肢と表示名はカテゴリ / タグのマスタから引く */
  protected readonly categories = this.categoryMaster.all;
  protected readonly tags = this.tagMaster.all;
  private readonly categoryNames = this.categoryMaster.namesById;
  private readonly tagNames = this.tagMaster.namesById;

  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly nameFilter = signal('');
  /** 絞り込みは ID で持つ */
  protected readonly categoryFilter = signal('');
  protected readonly tagFilter = signal('');

  /** 絞り込みは Signal の computed で行う（マスターは数百件を想定） */
  protected readonly filtered = computed<readonly Master[]>(() => {
    const keyword = this.nameFilter().trim().toLocaleLowerCase('ja');
    const categoryId = this.categoryFilter();
    const tagId = this.tagFilter();
    return this.masters.all().filter((master) => {
      if (keyword && !master.name.toLocaleLowerCase('ja').includes(keyword)) {
        return false;
      }
      if (categoryId && master.categoryId !== categoryId) {
        return false;
      }
      if (tagId && !master.tagIds.includes(tagId)) {
        return false;
      }
      return true;
    });
  });
  protected readonly sortOptions = SORT_OPTIONS;
  protected readonly sortKey = signal<SortKey>('name');
  /** 折りたたみ中は既定以外の並び順だけをチップで見せる */
  protected readonly sortChip = computed(() =>
    this.sortKey() === 'name'
      ? null
      : (SORT_OPTIONS.find((option) => option.key === this.sortKey())?.label ?? null),
  );

  /**
   * 絞り込んだ結果を並べ替える。`name` は `MasterService.all` が既に名前順なので
   * 並べ替えずに返し、他の順ではコピーしてから並べ替える（元の Signal は破壊しない）。
   */
  protected readonly sorted = computed<readonly Master[]>(() => {
    const list = this.filtered();
    const key = this.sortKey();
    if (key === 'name') {
      return list;
    }
    const usage = this.masters.usage();
    const byName = (a: Master, b: Master) => a.name.localeCompare(b.name, 'ja');
    return [...list].sort((a, b) => {
      if (key === 'created-desc') {
        return b.createdAt.localeCompare(a.createdAt) || byName(a, b);
      }
      const count = (master: Master) => usage.get(master.id)?.length ?? 0;
      return count(b) - count(a) || byName(a, b);
    });
  });

  protected readonly hasFilter = computed(
    () =>
      this.nameFilter().trim() !== '' || this.categoryFilter() !== '' || this.tagFilter() !== '',
  );

  /** 絞り込みパネルの開閉。初期表示は閉じておく */
  protected readonly filterOpen = signal(false);
  /**
   * 閉じている間に何で絞り込まれているかを見せるためのチップ。
   * 参照先が消えたカテゴリ / タグは名前を出せないので条件からは外れて見えないが、
   * `filtered()` 側では一致なしになるため「すべて解除」で戻せる。
   */
  protected readonly filterChips = computed<readonly FilterChip[]>(() => {
    const chips: FilterChip[] = [];
    const keyword = this.nameFilter().trim();
    if (keyword) {
      chips.push({ kind: 'name', text: `名前:${keyword}` });
    }
    const categoryId = this.categoryFilter();
    if (categoryId) {
      const name = this.categoryNames().get(categoryId);
      chips.push({ kind: 'category', text: `カテゴリ:${name ?? '不明'}` });
    }
    const tagId = this.tagFilter();
    if (tagId) {
      const name = this.tagNames().get(tagId);
      chips.push({ kind: 'tag', text: `#${name ?? '不明'}` });
    }
    return chips;
  });
  protected readonly noMatch = computed(
    () => this.loaded() && !this.isEmpty() && this.filtered().length === 0,
  );

  protected readonly editorOpen = signal(false);
  private readonly editingId = signal<string | null>(null);
  protected readonly editorHeading = computed(() =>
    this.editingId() ? 'オブジェクトを編集' : 'オブジェクトを追加',
  );

  private readonly editorModel = signal({ name: '', note: '' });
  protected readonly editorForm = form(this.editorModel, (master) => {
    required(master.name, { message: 'オブジェクト名を入力してください。' });
    maxLength(master.name, 100, { message: 'オブジェクト名は 100 文字以内で入力してください。' });
    maxLength(master.note, 500, { message: 'メモは 500 文字以内で入力してください。' });
  });
  protected readonly nameError = computed(() => firstErrorMessage(this.editorForm.name));
  protected readonly noteError = computed(() => firstErrorMessage(this.editorForm.note));

  /** 編集中に選ばれているカテゴリ（空文字は未設定）とタグ */
  protected readonly selectedCategoryId = signal('');
  protected readonly selectedTagIds = signal<readonly string[]>([]);

  /** 編集中の画像。保存されるまで DB には書かない */
  protected readonly pendingImage = signal<ImagePayload | null>(null);
  /** 画像が差し替えられたかを参照の同一性で判定するための元データ */
  private readonly originalImage = signal<ImagePayload | null>(null);

  protected readonly deleteOpen = signal(false);
  protected readonly deleteTarget = signal<Master | null>(null);

  /** 移し替えパネルの開閉。初期表示は閉じておく */
  protected readonly transferOpen = signal(false);
  protected readonly fileExtension = MASTER_FILE_EXTENSION;
  /** 選択されたファイルを検証したものと、取り込んだ場合の見積もり */
  protected readonly pendingFile = signal<MasterFile | null>(null);
  protected readonly pendingFileName = signal('');
  protected readonly pendingPreview = signal<MasterImportPreview | null>(null);
  protected readonly importMode = signal<MasterImportMode>('skip');
  protected readonly overwriteOpen = signal(false);

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

  /** 参照先が消えている場合は表示しない */
  protected categoryNameOf(master: Master): string | undefined {
    return master.categoryId ? this.categoryNames().get(master.categoryId) : undefined;
  }

  protected tagNamesOf(master: Master): readonly string[] {
    const names = this.tagNames();
    return master.tagIds.map((id) => names.get(id)).filter((name) => name !== undefined);
  }

  protected isTagSelected(tagId: string): boolean {
    return this.selectedTagIds().includes(tagId);
  }

  protected toggleTag(tagId: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selectedTagIds.update((ids) =>
      checked ? [...ids, tagId] : ids.filter((id) => id !== tagId),
    );
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

  /** `select` の値は文字列なので、既知のキーに絞ってから反映する */
  protected onSortChange(event: Event): void {
    const value = inputValue(event);
    this.sortKey.set(SORT_OPTIONS.find((option) => option.key === value)?.key ?? 'name');
  }

  protected onCategoryChange(event: Event): void {
    this.selectedCategoryId.set(inputValue(event));
  }

  protected clearFilters(): void {
    this.nameFilter.set('');
    this.categoryFilter.set('');
    this.tagFilter.set('');
  }

  /** チップの × で条件を 1 つだけ外す */
  protected clearFilter(kind: FilterKind): void {
    switch (kind) {
      case 'name':
        this.nameFilter.set('');
        return;
      case 'category':
        this.categoryFilter.set('');
        return;
      case 'tag':
        this.tagFilter.set('');
        return;
    }
  }

  protected openCreate(): void {
    this.editingId.set(null);
    this.editorModel.set({ name: '', note: '' });
    this.editorForm().reset();
    this.selectedCategoryId.set('');
    this.selectedTagIds.set([]);
    this.setImage(null);
    this.editorOpen.set(true);
  }

  protected async openEdit(master: Master): Promise<void> {
    this.editingId.set(master.id);
    this.editorModel.set({ name: master.name, note: master.note ?? '' });
    this.editorForm().reset();
    this.selectedCategoryId.set(master.categoryId ?? '');
    this.selectedTagIds.set([...master.tagIds]);
    this.setImage(null);
    this.editorOpen.set(true);
    this.reset();
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
    const { name, note } = this.editorModel();
    const categoryId = this.selectedCategoryId();
    const tagIds = this.selectedTagIds();
    const id = this.editingId();
    this.busy.set(true);
    this.reset();
    try {
      const saved = id
        ? await this.masters.update(id, { name, categoryId, tagIds, note })
        : await this.masters.create(this.projectId(), { name, categoryId, tagIds, note });
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
    this.reset();
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

  /** このプロジェクトのオブジェクトマスタを `.tallia` ファイルに書き出す */
  protected async exportMasters(): Promise<void> {
    this.reset();
    try {
      const file = await this.transfer.exportProject(this.projectId());
      const name = this.project()?.name ?? '';
      this.transfer.download(file, this.transfer.fileName(name));
      this.notice.set('オブジェクトマスタを書き出しました。');
    } catch (error) {
      this.error.set(toMessage(error));
    }
  }

  /** 選んだファイルを検証し、取り込んだ場合の見積もりを出す（まだ書き込まない） */
  protected async onTransferFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    this.reset();
    this.clearPendingFile();
    try {
      const parsed = this.transfer.parse(await file.text());
      this.pendingPreview.set(await this.transfer.preview(this.projectId(), parsed));
      this.pendingFile.set(parsed);
      this.pendingFileName.set(file.name);
    } catch (error) {
      this.error.set(toMessage(error));
    } finally {
      // 同じファイルを選び直せるように値をクリアする
      input.value = '';
    }
  }

  protected setImportMode(mode: MasterImportMode): void {
    this.importMode.set(mode);
  }

  /** 上書きで実際に置き換わるものがあるときだけ確認を挟む */
  protected startImport(): void {
    if (!this.pendingFile()) {
      return;
    }
    const mode = this.importMode();
    if (mode === 'overwrite' && (this.pendingPreview()?.existing ?? 0) > 0) {
      this.overwriteOpen.set(true);
      return;
    }
    void this.runImport(mode);
  }

  protected confirmOverwrite(): void {
    void this.runImport('overwrite');
  }

  private async runImport(mode: MasterImportMode): Promise<void> {
    const file = this.pendingFile();
    if (!file) {
      return;
    }
    this.reset();
    this.busy.set(true);
    try {
      const result = await this.transfer.import(this.projectId(), file, mode);
      this.clearPendingFile();
      await this.load(this.projectId());
      this.notice.set(importedMessage(result));
    } catch (error) {
      this.error.set(toMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  private clearPendingFile(): void {
    this.pendingFile.set(null);
    this.pendingFileName.set('');
    this.pendingPreview.set(null);
  }

  private reset(): void {
    this.error.set(null);
    this.notice.set(null);
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
      // 選択肢と表示名に使うため、分類マスタも読み込む
      await Promise.all([this.categoryMaster.load(projectId), this.tagMaster.load(projectId)]);
      await this.images.loadByProject(projectId);
    } catch (error) {
      this.error.set(toMessage(error));
    }
  }
}

/** 取り込み結果を利用者向けの 1 行にする。0 件の項目は出さない */
function importedMessage(result: MasterImportResult): string {
  const parts = [`追加 ${result.added} 件`];
  if (result.updated > 0) {
    parts.push(`上書き ${result.updated} 件`);
  }
  if (result.skipped > 0) {
    parts.push(`同名のため見送り ${result.skipped} 件`);
  }
  if (result.images > 0) {
    parts.push(`画像 ${result.images} 枚`);
  }
  const labels = result.categories + result.tags;
  if (labels > 0) {
    parts.push(`新しい分類 ${labels} 件`);
  }
  return `取り込みました（${parts.join(' / ')}）。`;
}
