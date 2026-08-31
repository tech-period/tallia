/**
 * ファイルの書き出しにまつわる小物。
 * バックアップとマスタの移し替えで同じ規則を使うため、ここにまとめる。
 */

/** 書き出しファイル名に埋める `YYYYMMDD-HHmmss`。端末のローカル時刻で作る */
export function timestampForFileName(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/** ファイル名に使えない文字を潰し、長すぎる名前を切り詰める */
export function sanitizeForFileName(name: string, fallback = 'project'): string {
  return name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || fallback;
}

/** 文字列を Blob にしてダウンロードさせる。Object URL は必ず解放する */
export function downloadText(text: string, fileName: string, type: string): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
