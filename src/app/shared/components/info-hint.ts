import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, ElementRef, inject, input, signal } from '@angular/core';

let nextHintId = 0;

/**
 * ⓘ を押したときだけ補足を出す開閉式のヒント。
 * 画面上は常時アイコンだけを置き、説明文で本文を埋めないためのもの。
 */
@Component({
  selector: 'app-info-hint',
  host: {
    class: 'relative inline-flex align-middle',
    '(keydown.escape)': 'close()',
  },
  template: `
    <button
      type="button"
      class="btn-info"
      [attr.aria-label]="label() + 'を表示'"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="panelId"
      (click)="toggle()"
    >
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        class="h-5 w-5"
        aria-hidden="true"
      >
        <circle cx="10" cy="10" r="7.25" />
        <path d="M10 9.25v4.5" stroke-linecap="round" />
        <circle cx="10" cy="6.4" r="0.9" fill="currentColor" stroke="none" />
      </svg>
    </button>
    @if (open()) {
      <div
        [id]="panelId"
        class="absolute top-full left-0 z-30 mt-1 w-64 max-w-[calc(100vw-3rem)] rounded-md border border-slate-300 bg-white p-3 text-left text-sm leading-relaxed font-normal whitespace-pre-line text-slate-700 shadow-lg"
      >
        {{ text() }}
      </div>
    }
  `,
})
export class InfoHint {
  /** 開いたときに出す本文 */
  readonly text = input.required<string>();
  /** ボタンの読み上げ名。「〜を表示」が付く */
  readonly label = input('説明');

  protected readonly panelId = `info-hint-${nextHintId++}`;
  private readonly openSignal = signal(false);
  protected readonly open = this.openSignal.asReadonly();

  private readonly host = inject(ElementRef<HTMLElement>);

  constructor() {
    // 外側をクリック・タップしたら閉じる
    const document = inject(DOCUMENT);
    const onPointerDown = (event: Event) => {
      const target = event.target as Node | null;
      if (this.openSignal() && target && !this.host.nativeElement.contains(target)) {
        this.openSignal.set(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('pointerdown', onPointerDown));
  }

  protected toggle(): void {
    this.openSignal.update((open) => !open);
  }

  protected close(): void {
    this.openSignal.set(false);
  }
}
