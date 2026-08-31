/** マスターが 1 件以上のインスタンスから参照されているため削除できない */
export class MasterInUseError extends Error {
  constructor(
    readonly masterId: string,
    readonly usageCount: number,
  ) {
    super(`このオブジェクトは ${usageCount} 件のケースで使用中のため削除できません。`);
    this.name = 'MasterInUseError';
  }
}

/** 参照先のレコードが存在しない */
export class NotFoundError extends Error {
  constructor(
    readonly entity: string,
    readonly id: string,
  ) {
    super(`${entity}が見つかりません（${id}）。`);
    this.name = 'NotFoundError';
  }
}

/** バックアップファイルの形式が不正 */
export class InvalidBackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidBackupError';
  }
}

/** 例外から利用者向けメッセージを取り出す */
export function toMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'エラーが発生しました。';
}
