/** 新しいエンティティ ID を発行する */
export function newId(): string {
  return crypto.randomUUID();
}

/** 現在時刻を ISO 8601 文字列で返す */
export function nowIso(): string {
  return new Date().toISOString();
}
