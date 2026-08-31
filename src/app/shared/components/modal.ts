import { Component, ElementRef, effect, input, model, viewChild } from '@angular/core';

let nextModalId = 0;

/**
 * ネイティブ `<dialog>` を使ったモーダル。
 * フォーカストラップと Esc での閉じる操作はブラウザ実装に任せる。
 */
@Component({
  selector: 'app-modal',
  template: `
    <dialog
      #dialog
      class="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-xl bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-900/50"
      [attr.aria-labelledby]="headingId"
      (close)="open.set(false)"
    >
      <div class="flex max-h-[85vh] flex-col">
        <div class="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <h2 [id]="headingId" class="text-lg font-semibold">{{ heading() }}</h2>
          <button type="button" class="btn-icon shrink-0" (click)="close()" aria-label="閉じる">
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <div class="overflow-y-auto px-5 py-4">
          <ng-content />
        </div>
        <div class="border-t border-slate-200 bg-slate-50 px-5 py-3">
          <ng-content select="[modalFooter]" />
        </div>
      </div>
    </dialog>
  `,
})
export class Modal {
  readonly open = model.required<boolean>();
  readonly heading = input.required<string>();

  protected readonly headingId = `modal-heading-${nextModalId++}`;
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const element = this.dialog().nativeElement;
      if (this.open()) {
        if (!element.open) {
          element.showModal();
        }
      } else if (element.open) {
        element.close();
      }
    });
  }

  protected close(): void {
    this.open.set(false);
  }
}
