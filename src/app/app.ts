import { Component, ElementRef, inject, viewChild } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AppUpdateService } from './core/services/app-update.service';
import { StorageService } from './core/services/storage.service';
import { InfoHint } from './shared/components/info-hint';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, InfoHint],
  templateUrl: './app.html',
})
export class App {
  protected readonly appUpdate = inject(AppUpdateService);
  protected readonly storage = inject(StorageService);

  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');

  constructor() {
    // 初回起動時に永続化を要求する。拒否されても機能は継続する。
    void this.storage.requestPersistence();
  }

  protected reload(): void {
    void this.appUpdate.applyUpdate();
  }

  /** スキップリンク: URL のフラグメントを変えずに本文へフォーカスを移す */
  protected skipToMain(): void {
    this.main().nativeElement.focus();
  }
}
