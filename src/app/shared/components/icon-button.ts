import { booleanAttribute, Component, computed, input, output } from '@angular/core';

/** アイコンだけで表す操作ボタン。ラベルは読み上げ用に必ず受け取る */
@Component({
  selector: 'app-icon-button',
  host: { class: 'inline-flex' },
  template: `
    <button
      type="button"
      [class]="subtle() ? 'btn-icon-quiet' : 'btn-icon-lg'"
      [class.btn-icon-danger]="danger()"
      [class.btn-icon-fill]="filled()"
      [disabled]="disabled()"
      [attr.aria-label]="label()"
      (click)="pressed.emit()"
    >
      @switch (icon()) {
        @case ('edit') {
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
            [class]="glyphSize()"
            aria-hidden="true"
          >
            <path d="M4 20h4L18.5 9.5a2.47 2.47 0 0 0-3.5-3.5L4 16.5z" />
            <path d="M13.5 7.5 17 11" />
          </svg>
        }
        @case ('add') {
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.9"
            stroke-linecap="round"
            [class]="glyphSize()"
            aria-hidden="true"
          >
            <path d="M12 5.5v13M5.5 12h13" />
          </svg>
        }
        @case ('delete') {
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
            [class]="glyphSize()"
            aria-hidden="true"
          >
            <path d="M4.5 6.5h15" />
            <path d="M9.5 6.5V4.9c0-.5.4-.9.9-.9h3.2c.5 0 .9.4.9.9v1.6" />
            <path d="M6.6 6.5 7.5 19a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l.9-12.5" />
            <path d="M10.4 10.3v6.3M13.6 10.3v6.3" />
          </svg>
        }
        @case ('move-up') {
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            [class]="glyphSize()"
            aria-hidden="true"
          >
            <path d="m6 14.5 6-6 6 6" />
          </svg>
        }
        @case ('move-down') {
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            [class]="glyphSize()"
            aria-hidden="true"
          >
            <path d="m6 9.5 6 6 6-6" />
          </svg>
        }
      }
    </button>
  `,
})
export class IconButton {
  readonly icon = input.required<'add' | 'edit' | 'delete' | 'move-up' | 'move-down'>();
  /** アイコンしか出ないため、読み上げ名は必須にする */
  readonly label = input.required<string>();
  readonly danger = input(false, { transform: booleanAttribute });
  /** 塗りつぶしの円形にする。同じ並びの他のアイコンボタンと役割が違うときに使う */
  readonly filled = input(false, { transform: booleanAttribute });
  /** 枠を外して一回り小さくする。主操作の隣に置く補助的な操作に使う */
  readonly subtle = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly pressed = output<void>();

  protected readonly glyphSize = computed(() => (this.subtle() ? 'h-4 w-4' : 'h-5 w-5'));
}
