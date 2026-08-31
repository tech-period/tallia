import { Component, input, model, output } from '@angular/core';
import { Modal } from './modal';

/** 破壊的操作の前に挟む確認ダイアログ */
@Component({
  selector: 'app-confirm-dialog',
  imports: [Modal],
  template: `
    <app-modal [(open)]="open" [heading]="heading()">
      <p class="text-sm leading-relaxed whitespace-pre-line text-slate-700">{{ message() }}</p>
      @if (details().length > 0) {
        <ul class="mt-3 list-inside list-disc space-y-1 text-sm text-slate-700">
          @for (detail of details(); track detail) {
            <li>{{ detail }}</li>
          }
        </ul>
      }
      <div modalFooter class="flex flex-wrap justify-end gap-2">
        <button type="button" class="btn btn-secondary" (click)="open.set(false)">
          キャンセル
        </button>
        <button
          type="button"
          class="btn"
          [class.btn-danger]="danger()"
          [class.btn-primary]="!danger()"
          (click)="onConfirm()"
        >
          {{ confirmLabel() }}
        </button>
      </div>
    </app-modal>
  `,
})
export class ConfirmDialog {
  readonly open = model.required<boolean>();
  readonly heading = input.required<string>();
  readonly message = input.required<string>();
  readonly details = input<readonly string[]>([]);
  readonly confirmLabel = input('削除する');
  readonly danger = input(true);

  readonly confirmed = output<void>();

  protected onConfirm(): void {
    this.open.set(false);
    this.confirmed.emit();
  }
}
