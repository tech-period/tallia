import { Service, inject } from '@angular/core';
import { ImagePayload, ProjectImage } from '../db/schema';
import { ProjectImageRepository } from '../repositories/project-image.repository';
import { nowIso } from '../../shared/utils/id';
import { ImageUrlCache } from './image-url-cache';

/**
 * プロジェクトのイメージ画像を扱う。
 * 表示用の Object URL はここで一元管理し、差し替え時に必ず解放する。
 */
@Service()
export class ProjectImageService {
  private readonly images = inject(ProjectImageRepository);
  private readonly cache = new ImageUrlCache();

  /** プロジェクト ID → 表示用 URL。画像が無いプロジェクトは含まれない */
  readonly urls = this.cache.urls;

  /** 一覧表示用にすべての画像を読み込む。更新のないものは URL を使い回す */
  async loadAll(): Promise<void> {
    const stored = await this.images.getAll();
    this.cache.replaceAll(stored.map((image) => ({ ...image, id: image.projectId })));
  }

  /** 1 プロジェクト分だけ読み込んで表示用 URL を用意する（詳細画面用） */
  async ensure(projectId: string): Promise<void> {
    this.cache.sync(projectId, (await this.images.getByProject(projectId)) ?? null);
  }

  /** 編集画面で元画像を読み込む */
  async get(projectId: string): Promise<ProjectImage | null> {
    return (await this.images.getByProject(projectId)) ?? null;
  }

  /** 画像を保存（既にあれば置き換え）する */
  async save(projectId: string, payload: ImagePayload): Promise<void> {
    const image: ProjectImage = {
      projectId,
      data: payload.data,
      type: payload.type,
      width: payload.width,
      height: payload.height,
      size: payload.data.byteLength,
      updatedAt: nowIso(),
    };
    await this.images.put(image);
    this.cache.set(projectId, image);
  }

  /** 画像を削除する */
  async remove(projectId: string): Promise<void> {
    await this.images.deleteByProject(projectId);
    this.cache.remove(projectId);
  }

  /**
   * 保持している URL を解放する。
   * プロジェクト削除のようにレコード側が別途消える場合に呼ぶ。
   */
  forget(projectId: string): void {
    this.cache.remove(projectId);
  }

  /** 全プロジェクト分の URL を解放する（全削除・置換インポート後に呼ぶ） */
  forgetAll(): void {
    this.cache.clear();
  }
}
