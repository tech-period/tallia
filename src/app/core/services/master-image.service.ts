import { Service, inject } from '@angular/core';
import { ImagePayload, MasterImage } from '../db/schema';
import { MasterImageRepository } from '../repositories/master-image.repository';
import { nowIso } from '../../shared/utils/id';
import { ImageUrlCache } from './image-url-cache';

/**
 * オブジェクト（マスター）のイメージ画像を扱う。
 * 画面には常に 1 プロジェクト分しか出ないため、URL も表示中プロジェクト分だけ保持する。
 */
@Service()
export class MasterImageService {
  private readonly images = inject(MasterImageRepository);
  private readonly cache = new ImageUrlCache();

  /** オブジェクト ID → 表示用 URL。画像が無いオブジェクトは含まれない */
  readonly urls = this.cache.urls;

  /** `by-project` インデックスで、表示中プロジェクト分だけを読み込む */
  async loadByProject(projectId: string): Promise<void> {
    const stored = await this.images.getByProject(projectId);
    this.cache.replaceAll(stored.map((image) => ({ ...image, id: image.masterId })));
  }

  /** 編集画面で元画像を読み込む */
  async get(masterId: string): Promise<MasterImage | null> {
    return (await this.images.getByMaster(masterId)) ?? null;
  }

  /** 画像を保存（既にあれば置き換え）する */
  async save(masterId: string, projectId: string, payload: ImagePayload): Promise<void> {
    const image: MasterImage = {
      masterId,
      projectId,
      data: payload.data,
      type: payload.type,
      width: payload.width,
      height: payload.height,
      size: payload.data.byteLength,
      updatedAt: nowIso(),
    };
    await this.images.put(image);
    this.cache.set(masterId, image);
  }

  /** 画像を削除する */
  async remove(masterId: string): Promise<void> {
    await this.images.deleteByMaster(masterId);
    this.cache.remove(masterId);
  }

  /** レコード側が別途消える場合に URL だけ解放する */
  forget(masterId: string): void {
    this.cache.remove(masterId);
  }

  /** 保持中の URL をすべて解放する（プロジェクト削除・全削除・置換インポート後に呼ぶ） */
  forgetAll(): void {
    this.cache.clear();
  }
}
