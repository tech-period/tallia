import { FieldTree } from '@angular/forms/signals';

/**
 * 入力済みの項目について、最初のバリデーションエラーの文言を返す。
 * リアクティブに評価されるため `computed()` から呼ぶこと。
 */
export function firstErrorMessage<T>(field: FieldTree<T>): string | null {
  const state = field();
  if (!state.touched()) {
    return null;
  }
  const error: { message?: string } | undefined = state.errors()[0];
  if (!error) {
    return null;
  }
  return error.message ?? '入力内容を確認してください。';
}

/** `input` / `change` イベントから値を型安全に取り出す */
export function inputValue(event: Event): string {
  const target = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
  return target?.value ?? '';
}
