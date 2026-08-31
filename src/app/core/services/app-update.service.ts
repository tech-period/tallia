import { Service, inject, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';

/**
 * Service Worker の更新を監視する。
 * 編集中のデータを失わないよう、自動リロードはしない。
 */
@Service()
export class AppUpdateService {
  private readonly swUpdate = inject(SwUpdate);
  private readonly updateReadySignal = signal(false);

  /** 新しいバージョンがインストール済みで、再読み込みを待っている */
  readonly updateReady = this.updateReadySignal.asReadonly();

  constructor() {
    if (!this.swUpdate.isEnabled) {
      return;
    }
    this.swUpdate.versionUpdates.subscribe((event) => {
      if (event.type === 'VERSION_READY') {
        this.updateReadySignal.set(true);
      }
    });
  }

  /** 利用者が明示的に押したときだけ再読み込みする */
  async applyUpdate(): Promise<void> {
    if (this.swUpdate.isEnabled) {
      await this.swUpdate.activateUpdate();
    }
    location.reload();
  }
}
