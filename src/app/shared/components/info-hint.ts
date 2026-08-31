import { Component, input, signal } from '@angular/core';

let nextHintId = 0;

/**
 * ⓘ を押したときだけ補足を出す開閉式のヒント。
 * 画面上は常時アイコンだけを置き、説明文で本文を埋めないためのもの。
 *
 * 表示にはネイティブの Popover API を使う。位置決め・最前面表示・
 * 外側タップや Esc で閉じる動作はブラウザに任せ、座標計算はしない。
 */
@Component({
  selector: 'app-info-hint',
  host: { class: 'inline-flex align-middle' },
  styles: `
    [popover]::backdrop {
      background: rgb(15 23 42 / 0.15);
    }
  `,
  template: `
    <button
      type="button"
      class="btn-info"
      [attr.aria-label]="label() + 'を表示'"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="panelId"
      [attr.popovertarget]="panelId"
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
    <div
      popover
      [id]="panelId"
      (toggle)="open.set($event.newState === 'open')"
      class="m-auto max-h-[80svh] w-64 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md border border-slate-300 bg-white p-3 text-left text-sm leading-relaxed font-normal whitespace-pre-line text-slate-700 shadow-lg"
    >
      {{ text() }}
    </div>
  `,
})
export class InfoHint {
  /** 開いたときに出す本文 */
  readonly text = input.required<string>();
  /** ボタンの読み上げ名。「〜を表示」が付く */
  readonly label = input('説明');

  protected readonly panelId = `info-hint-${nextHintId++}`;
  /** 外側タップや Esc でもブラウザが閉じるため、toggle イベントで状態を取り込む */
  protected readonly open = signal(false);
}
