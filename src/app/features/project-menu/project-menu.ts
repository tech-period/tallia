import { Component, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Project } from '../../core/db/schema';
import { toMessage } from '../../core/services/errors';
import { ProjectImageService } from '../../core/services/project-image.service';
import { ProjectService, ProjectStats } from '../../core/services/project.service';
import { ErrorBanner } from '../../shared/components/error-banner';

@Component({
  selector: 'app-project-menu',
  imports: [RouterLink, ErrorBanner],
  templateUrl: './project-menu.html',
})
export class ProjectMenu {
  /** ルートパラメータ `/projects/:projectId` */
  readonly projectId = input.required<string>();

  private readonly projects = inject(ProjectService);
  private readonly images = inject(ProjectImageService);
  private readonly router = inject(Router);

  protected readonly project = signal<Project | null>(null);
  /** 読み込むまでは件数を出さない */
  protected readonly counts = signal<ProjectStats | null>(null);
  protected readonly imageUrls = this.images.urls;

  protected readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const id = this.projectId();
      void this.load(id);
    });
  }

  protected imageUrl(): string | undefined {
    return this.imageUrls().get(this.projectId());
  }

  private async load(projectId: string): Promise<void> {
    try {
      const project = await this.projects.getById(projectId);
      if (!project) {
        // 存在しない ID は一覧へ戻す
        await this.router.navigate(['/']);
        return;
      }
      this.project.set(project);
      await this.images.ensure(projectId);
      this.counts.set(await this.projects.countSummary(projectId));
    } catch (error) {
      this.error.set(toMessage(error));
    }
  }
}
