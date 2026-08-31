import { DOCUMENT } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { ImagePayload } from '../../core/db/schema';
import { toMessage } from '../../core/services/errors';
import {
  formatBytes,
  imageFromClipboardEvent,
  imageFromDataTransfer,
  processImage,
  readImageFromClipboard,
  toObjectUrl,
} from '../utils/image';
import { InfoHint } from './info-hint';

/**
 * 画像の貼り付け・ドロップ・ファイル選択をまとめて受け付けるコントロール。
 *
 * Web の画像検索からコピーした画像をそのまま貼り付けられるよう、
 * ペーストは画面全体で拾う（文字入力中のペーストには反応しない）。
 * 画像 URL だけがコピーされている場合は、外部通信をしない方針のため取り込まない。
 */
@Component({
  selector: 'app-image-picker',
  imports: [InfoHint],
  template: `
    <div
      class="rounded-lg border-2 border-dashed p-3 transition-colors"
      [class.border-slate-300]="!dragging()"
      [class.bg-white]="!dragging()"
      [class.border-indigo-600]="dragging()"
      [class.bg-indigo-50]="dragging()"
      (dragover)="onDragOver($event)"
      (dragleave)="onDragLeave($event)"
      (drop)="onDrop($event)"
    >
      @if (previewUrl(); as url) {
        <div class="flex flex-wrap items-start gap-3">
          <img
            [src]="url"
            alt=""
            class="h-24 w-40 rounded-md border border-slate-200 bg-slate-100 object-cover"
          />
          <div class="text-sm text-slate-600">
            <p>{{ dimensions() }}</p>
            <p>{{ fileSize() }}</p>
          </div>
        </div>
      } @else {
        <div class="flex items-center gap-1 text-sm text-slate-600">
          <span>貼り付け / ドロップ / ファイル選択</span>
          <app-info-hint
            label="画像の取り込み方の説明"
            text="画像をコピーして Ctrl + V（Mac は ⌘ + V）で貼り付けるか、この枠にドラッグ＆ドロップ、またはファイルを選択してください。画像の URL だけがコピーされている場合は取り込みません。"
          />
        </div>
      }

      <div class="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          class="btn btn-secondary"
          [disabled]="busy()"
          (click)="pasteFromClipboard()"
        >
          クリップボードから貼り付け
        </button>
        <button
          type="button"
          class="btn btn-secondary"
          [disabled]="busy()"
          (click)="openFileDialog()"
        >
          ファイルを選択
        </button>
        @if (image()) {
          <button
            type="button"
            class="btn btn-ghost text-red-800 hover:bg-red-50"
            (click)="clear()"
          >
            画像を外す
          </button>
        }
      </div>

      <input
        #picker
        type="file"
        accept="image/*"
        class="sr-only"
        tabindex="-1"
        aria-hidden="true"
        (change)="onFileSelected($event)"
      />

      <p class="mt-2 text-sm text-slate-600" role="status">
        @if (busy()) {
          読み込み中…
        } @else if (notice(); as text) {
          {{ text }}
        }
      </p>
      @if (error(); as message) {
        <p class="mt-1 text-sm text-red-800" role="alert">{{ message }}</p>
      }
    </div>
  `,
})
export class ImagePicker {
  /** 選択中の画像。未選択は `null` */
  readonly image = model.required<ImagePayload | null>();
  /** 画面全体のペーストを拾うため、表示されていない間は無効にする */
  readonly enabled = input(true);

  private readonly document = inject(DOCUMENT);
  private readonly picker = viewChild.required<ElementRef<HTMLInputElement>>('picker');

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly dragging = signal(false);

  private readonly previewUrlSignal = signal<string | null>(null);
  protected readonly previewUrl = this.previewUrlSignal.asReadonly();

  protected readonly dimensions = computed(() => {
    const image = this.image();
    return image ? `${image.width} × ${image.height} px` : '';
  });
  protected readonly fileSize = computed(() => {
    const image = this.image();
    return image ? formatBytes(image.data.byteLength) : '';
  });

  constructor() {
    effect((onCleanup) => {
      const image = this.image();
      if (!image) {
        this.previewUrlSignal.set(null);
        return;
      }
      const url = toObjectUrl(image);
      this.previewUrlSignal.set(url);
      onCleanup(() => URL.revokeObjectURL(url));
    });

    // 画面のどこで貼り付けても拾えるようにする
    const onPaste = (event: Event) => this.onPaste(event as ClipboardEvent);
    this.document.addEventListener('paste', onPaste);
    inject(DestroyRef).onDestroy(() => this.document.removeEventListener('paste', onPaste));
  }

  protected openFileDialog(): void {
    this.picker().nativeElement.click();
  }

  protected async pasteFromClipboard(): Promise<void> {
    this.reset();
    try {
      const blob = await readImageFromClipboard();
      if (!blob) {
        this.notice.set('クリップボードに画像がありません。');
        return;
      }
      await this.apply(blob);
    } catch {
      // 権限が拒否された場合や未対応ブラウザではキーボード操作を案内する
      this.notice.set('クリップボードを読み取れません。Ctrl + V で貼り付けてください。');
    }
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
  }

  protected async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    this.dragging.set(false);
    this.reset();
    const blob = imageFromDataTransfer(event.dataTransfer);
    if (!blob) {
      this.notice.set('画像ファイルではありません。');
      return;
    }
    await this.apply(blob);
  }

  protected async onFileSelected(event: Event): Promise<void> {
    this.reset();
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // 同じファイルを選び直しても change が発火するようにクリアする
    input.value = '';
    if (file) {
      await this.apply(file);
    }
  }

  protected clear(): void {
    this.reset();
    this.image.set(null);
  }

  private async onPaste(event: ClipboardEvent): Promise<void> {
    if (!this.enabled()) {
      return;
    }
    const target = event.target as HTMLElement | null;
    // 文字入力中のペーストは通常どおり動かす
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) {
      return;
    }
    const blob = imageFromClipboardEvent(event);
    if (!blob) {
      this.reset();
      this.notice.set('貼り付けた内容に画像がありません。');
      return;
    }
    event.preventDefault();
    this.reset();
    await this.apply(blob);
  }

  private async apply(blob: Blob): Promise<void> {
    this.busy.set(true);
    try {
      this.image.set(await processImage(blob));
      this.notice.set('読み込みました。保存すると反映されます。');
    } catch (error) {
      this.error.set(toMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  private reset(): void {
    this.error.set(null);
    this.notice.set(null);
  }
}
