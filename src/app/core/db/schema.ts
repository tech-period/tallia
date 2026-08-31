/**
 * Tallia のデータモデル定義。
 *
 * 全エンティティはフラットに保持し、親子関係は外部キー + インデックスで表現する。
 * 日時は必ず ISO 文字列で保存する（`Date` オブジェクトは保存しない）。
 */

/** ISO 8601 形式の日時文字列（例: "2026-08-31T12:00:00.000Z"） */
export type IsoDateTime = string;

/** ゲームタイトル */
export interface Project {
  id: string;
  name: string;
  note?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** 記録の単位（ダンジョン、章、周回など） */
export interface Case {
  id: string;
  projectId: string;
  name: string;
  note?: string;
  /** 表示順。同一プロジェクト内で連番 */
  order: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** そのタイトルに登場するオブジェクトの定義 */
export interface Master {
  id: string;
  projectId: string;
  name: string;
  /** 任意の分類（武器 / 素材 など） */
  category?: string;
  tags: string[];
  note?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** どのケースに、どのマスターが、いくつあるか */
export interface Instance {
  id: string;
  /** 横断検索用に冗長保持する */
  projectId: string;
  caseId: string;
  masterId: string;
  /** 1 以上の整数 */
  qty: number;
  note?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/**
 * 画像レコードの共通部分。
 *
 * 一覧を描くだけなら画像を読まずに済むよう、画像は本体と別ストアに分けて保持する。
 * Blob ではなく `ArrayBuffer` + MIME 型で持つ（Blob の IndexedDB 保存は
 * 実装差があるため、どのブラウザでも確実に往復する形にそろえる）。
 */
export interface StoredImage {
  data: ArrayBuffer;
  /** 例: "image/webp" */
  type: string;
  width: number;
  height: number;
  /** `data.byteLength`。使用量の表示に使う */
  size: number;
  updatedAt: IsoDateTime;
}

/** プロジェクトのイメージ画像。1 プロジェクトにつき 1 枚 */
export interface ProjectImage extends StoredImage {
  projectId: string;
}

/** オブジェクトのイメージ画像。1 オブジェクトにつき 1 枚 */
export interface MasterImage extends StoredImage {
  masterId: string;
  /** 表示範囲の絞り込みとカスケード削除のために冗長保持する */
  projectId: string;
}

/** 画像の中身だけを取り回すための型（保存前の一時データにも使う） */
export type ImagePayload = Pick<StoredImage, 'data' | 'type' | 'width' | 'height'>;

export const BACKUP_FORMAT = 'tallia-backup';
/** オブジェクトの画像に対応した版。旧版（1: 画像なし / 2: プロジェクト画像のみ）も読み込める */
export const BACKUP_VERSION = 3;
export const SUPPORTED_BACKUP_VERSIONS: readonly number[] = [1, 2, 3];

/** バックアップ内の画像。JSON に載せるため base64 文字列にする */
export interface BackupImage {
  /** base64（データ URL ではなく本体のみ） */
  data: string;
  type: string;
  width: number;
  height: number;
  updatedAt: IsoDateTime;
}

export interface BackupProjectImage extends BackupImage {
  projectId: string;
}

export interface BackupMasterImage extends BackupImage {
  masterId: string;
  projectId: string;
}

/** エクスポート / インポートのファイル形式 */
export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: IsoDateTime;
  projects: Project[];
  cases: Case[];
  masters: Master[];
  instances: Instance[];
  /** プロジェクトの画像。version 1 のファイルには存在しない */
  images?: BackupProjectImage[];
  /** オブジェクトの画像。version 2 以前のファイルには存在しない */
  masterImages?: BackupMasterImage[];
}
