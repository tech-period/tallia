import { Component, input } from '@angular/core';

/** 「何をすればいいか」を書く空状態 */
@Component({
  selector: 'app-empty-state',
  template: `
    <div class="card flex flex-col items-center gap-3 px-6 py-12 text-center">
      <h2 class="text-base font-semibold text-slate-900">{{ heading() }}</h2>
      @if (description(); as text) {
        <p class="max-w-prose text-sm leading-relaxed text-slate-600">{{ text }}</p>
      }
      <ng-content />
    </div>
  `,
})
export class EmptyState {
  readonly heading = input.required<string>();
  readonly description = input('');
}
