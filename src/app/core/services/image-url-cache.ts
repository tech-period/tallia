import { Signal, signal } from '@angular/core';
import { StoredImage } from '../db/schema';
import { toObjectUrl } from '../../shared/utils/image';

interface Entry {
  url: string;
  updatedAt: string;
}

/**
 * 表示用 Object URL の作成と解放をまとめて面倒を見る。
 * 画像を扱う Service から使う想定で、DI には載せない（Service ごとに 1 つ持つ）。
 */
export class ImageUrlCache {
  private readonly entries = new Map<string, Entry>();
  private readonly urlsSignal = signal<ReadonlyMap<string, string>>(new Map());

  /** ID → 表示用 URL。画像が無い ID は含まれない */
  readonly urls: Signal<ReadonlyMap<string, string>> = this.urlsSignal.asReadonly();

  /** 渡された画像だけを保持する。更新されていないものは URL を使い回す */
  replaceAll(images: readonly (StoredImage & { id: string })[]): void {
    const seen = new Set<string>();
    for (const image of images) {
      seen.add(image.id);
      const cached = this.entries.get(image.id);
      if (cached?.updatedAt === image.updatedAt) {
        continue;
      }
      this.revoke(image.id);
      this.entries.set(image.id, { url: toObjectUrl(image), updatedAt: image.updatedAt });
    }
    for (const id of [...this.entries.keys()]) {
      if (!seen.has(id)) {
        this.revoke(id);
      }
    }
    this.publish();
  }

  /** 1 件の状態を反映する。更新されていなければ URL を使い回す */
  sync(id: string, image: StoredImage | null): void {
    if (!image) {
      this.remove(id);
      return;
    }
    if (this.entries.get(id)?.updatedAt === image.updatedAt) {
      return;
    }
    this.set(id, image);
  }

  /** 1 件を必ず作り直す（保存直後は同じ時刻でも内容が変わっているため） */
  set(id: string, image: StoredImage): void {
    this.revoke(id);
    this.entries.set(id, { url: toObjectUrl(image), updatedAt: image.updatedAt });
    this.publish();
  }

  remove(id: string): void {
    this.revoke(id);
    this.publish();
  }

  /** 通知せずに 1 件だけ解放する（複数件をまとめて操作するとき用） */
  private revoke(id: string): void {
    const cached = this.entries.get(id);
    if (cached) {
      URL.revokeObjectURL(cached.url);
      this.entries.delete(id);
    }
  }

  clear(): void {
    for (const id of [...this.entries.keys()]) {
      this.revoke(id);
    }
    this.publish();
  }

  private publish(): void {
    const snapshot = new Map<string, string>();
    for (const [id, cached] of this.entries) {
      snapshot.set(id, cached.url);
    }
    this.urlsSignal.set(snapshot);
  }
}
