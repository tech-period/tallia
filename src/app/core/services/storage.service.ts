import { Service, signal } from '@angular/core';
import { isIndexedDbAvailable } from '../db/database';

/** `navigator.storage` の状態 */
export interface StorageEstimateView {
  usageBytes: number | null;
  quotaBytes: number | null;
}

@Service()
export class StorageService {
  private readonly persistedSignal = signal<boolean | null>(null);
  private readonly estimateSignal = signal<StorageEstimateView | null>(null);

  /** 永続化が有効か。`null` は未判定 / 未対応 */
  readonly persisted = this.persistedSignal.asReadonly();
  readonly estimate = this.estimateSignal.asReadonly();

  /** ブラウザが IndexedDB を利用できるか */
  readonly indexedDbAvailable = isIndexedDbAvailable();

  /**
   * 初回起動時にストレージの永続化を要求する。
   * 拒否されても機能は継続する。
   */
  async requestPersistence(): Promise<boolean | null> {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
      this.persistedSignal.set(null);
      return null;
    }
    try {
      const alreadyPersisted = (await navigator.storage.persisted?.()) ?? false;
      const granted = alreadyPersisted || (await navigator.storage.persist());
      this.persistedSignal.set(granted);
      return granted;
    } catch {
      this.persistedSignal.set(null);
      return null;
    }
  }

  /** 使用量を読み直す */
  async refreshEstimate(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
      this.estimateSignal.set(null);
      return;
    }
    try {
      const estimate = await navigator.storage.estimate();
      this.estimateSignal.set({
        usageBytes: estimate.usage ?? null,
        quotaBytes: estimate.quota ?? null,
      });
    } catch {
      this.estimateSignal.set(null);
    }
  }
}
