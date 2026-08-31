import { ImagePayload } from '../../core/db/schema';

/** 保存する画像の最長辺（px）。原寸のまま持つと DB が膨らむため縮小する */
export const MAX_IMAGE_EDGE = 960;
/** 取り込みを受け付ける元画像の上限（20MB） */
export const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
/** 圧縮の優先順位。先頭から順に試し、ブラウザが対応する形式を使う */
const ENCODE_TYPES = ['image/webp', 'image/jpeg', 'image/png'] as const;
const ENCODE_QUALITY = 0.85;

/** 画像の取り込みに失敗した理由を利用者向けの文言で伝える */
export class ImageInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageInputError';
  }
}

/**
 * クリップボードのペーストから画像を取り出す。
 * Web の画像検索から「画像をコピー」した場合はここで拾える。
 * 画像そのものではなく URL 文字列がコピーされている場合は `null` を返す
 * （外部通信は行わない方針のため、URL からの取得はしない）。
 */
export function imageFromClipboardEvent(event: ClipboardEvent): Blob | null {
  return imageFromDataTransfer(event.clipboardData);
}

/** ドラッグ&ドロップ / ペーストの `DataTransfer` から最初の画像を取り出す */
export function imageFromDataTransfer(transfer: DataTransfer | null): Blob | null {
  if (!transfer) {
    return null;
  }
  for (let index = 0; index < transfer.items.length; index += 1) {
    const item = transfer.items[index];
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        return file;
      }
    }
  }
  for (let index = 0; index < transfer.files.length; index += 1) {
    const file = transfer.files[index];
    if (file.type.startsWith('image/')) {
      return file;
    }
  }
  return null;
}

/**
 * 非同期クリップボード API から画像を読む（ボタン操作用）。
 * 未対応のブラウザでは `null` を返し、拒否された場合は例外を投げる。
 */
export async function readImageFromClipboard(): Promise<Blob | null> {
  const clipboard: Clipboard | undefined = navigator.clipboard;
  if (typeof clipboard?.read !== 'function') {
    return null;
  }
  const items = await clipboard.read();
  for (const item of items) {
    const type = item.types.find((candidate) => candidate.startsWith('image/'));
    if (type) {
      return item.getType(type);
    }
  }
  return null;
}

/**
 * 取り込んだ画像を縮小・再圧縮して保存できる形にする。
 * 元の形式に関わらず、ブラウザが対応する最も軽い形式へ変換する。
 */
export async function processImage(source: Blob): Promise<ImagePayload> {
  if (!source.type.startsWith('image/')) {
    throw new ImageInputError(
      '画像として読み取れないデータです。PNG や JPEG などの画像を貼り付けてください。',
    );
  }
  if (source.size > MAX_SOURCE_BYTES) {
    throw new ImageInputError(
      `画像が大きすぎます（${formatBytes(source.size)}）。${formatBytes(MAX_SOURCE_BYTES)} 以下の画像を選んでください。`,
    );
  }

  const bitmap = await createImageBitmap(source).catch(() => null);
  if (!bitmap) {
    throw new ImageInputError(
      'この画像を読み取れませんでした。別の画像を貼り付けるか、PNG / JPEG で保存し直してください。',
    );
  }

  try {
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new ImageInputError(
        'この環境では画像を処理できませんでした。別のブラウザでお試しください。',
      );
    }
    context.drawImage(bitmap, 0, 0, width, height);

    const encoded = await encode(canvas);
    return { data: await encoded.arrayBuffer(), type: encoded.type, width, height };
  } finally {
    bitmap.close();
  }
}

/** 保存済みの画像データを表示用の Object URL にする。呼び出し側が必ず解放すること */
export function toObjectUrl(image: ImagePayload): string {
  return URL.createObjectURL(new Blob([image.data], { type: image.type }));
}

/** バイト数を人が読める文字列にする */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** JSON へ載せるための base64 変換 */
export function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // 一度に渡すと引数が多すぎて例外になるため小分けにする
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/** base64 から復元する。壊れた文字列は例外を投げる */
export function base64ToBytes(text: string): ArrayBuffer {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

async function encode(canvas: HTMLCanvasElement): Promise<Blob> {
  for (const type of ENCODE_TYPES) {
    const blob = await toBlob(canvas, type);
    // 未対応の形式を渡すと image/png で返るため、要求どおりか確かめる
    if (blob && blob.type === type) {
      return blob;
    }
    if (blob && type === 'image/png') {
      return blob;
    }
  }
  throw new ImageInputError(
    'この環境では画像を保存できる形式に変換できませんでした。別のブラウザでお試しください。',
  );
}

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, ENCODE_QUALITY);
  });
}
