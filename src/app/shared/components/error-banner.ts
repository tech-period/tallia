import { Component, input, output } from '@angular/core';

/** 何が起きたかと次にどうすべきかを伝えるエラー表示 */
@Component({
  selector: 'app-error-banner',
  template: `
    @if (message(); as text) {
      <div
        role="alert"
        class="mb-4 flex items-start justify-between gap-3 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900"
      >
        <p class="leading-relaxed whitespace-pre-line">{{ text }}</p>
        <button
          type="button"
          class="shrink-0 rounded px-2 py-0.5 font-medium text-red-900 hover:bg-red-100"
          (click)="dismissed.emit()"
        >
          閉じる
        </button>
      </div>
    }
  `,
})
export class ErrorBanner {
  readonly message = input<string | null>(null);
  readonly dismissed = output<void>();
}
