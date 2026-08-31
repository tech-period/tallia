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

/**
 * カテゴリとタグに共通する「分類マスタ」の形。
 * どちらもプロジェクトごとに定義し、オブジェクトからは ID で参照する。
 */
export interface Label {
  id: string;
  projectId: string;
  name: string;
  /** 表示順。同一プロジェクト内で連番 */
  order: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** オブジェクトの分類（武器 / 素材 など）。1 オブジェクトにつき 1 つ */
export type Category = Label;

/** オブジェクトに付けるしるし（レア / 換金用 など）。1 オブジェクトに複数付けられる */
export type Tag = Label;

/** そのタイトルに登場するオブジェクトの定義 */
export interface Master {
  id: string;
  projectId: string;
  name: string;
  /** 任意の分類（→ Category.id）。未設定なら省略する */
  categoryId?: string;
  /** → Tag.id の配列。空配列可 */
  tagIds: string[];
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
/**
 * カテゴリ / タグのマスタ化に対応した版。旧版も読み込める
 * （1: 画像なし / 2: プロジェクト画像のみ / 3: カテゴリ・タグが文字列）。
 */
export const BACKUP_VERSION = 4;
export const SUPPORTED_BACKUP_VERSIONS: readonly number[] = [1, 2, 3, 4];

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

/**
 * エクスポート / インポートのファイル形式。
 *
 * version 3 以前の `masters` はカテゴリ / タグを文字列で持つ。読み込み時に
 * `categories` / `tags` のレコードへ振り替える（BackupService）。
 */
export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: IsoDateTime;
  projects: Project[];
  cases: Case[];
  /** version 3 以前のファイルには存在しない */
  categories?: Category[];
  /** version 3 以前のファイルには存在しない */
  tags?: Tag[];
  masters: Master[];
  instances: Instance[];
  /** プロジェクトの画像。version 1 のファイルには存在しない */
  images?: BackupProjectImage[];
  /** オブジェクトの画像。version 2 以前のファイルには存在しない */
  masterImages?: BackupMasterImage[];
}

/* --------------------------------------------------------------------------
 * マスタの移し替え（プロジェクト間の持ち出し / 取り込み）
 *
 * 対象はマスタ 4 種（ケース / カテゴリ / タグ / オブジェクト）。
 * バックアップとは目的が違うため、形式も別立てにする。
 *
 * 取り込み先は必ず別のプロジェクトなので、ID を運んでも意味を持たない。
 * そのため ID は一切載せず、突合は名前で行う。
 * オブジェクトとカテゴリ / タグの紐付けも、ID ではなく名前で運ぶ。
 * -------------------------------------------------------------------------- */

export const MASTER_FILE_FORMAT = 'tallia-masters';
/** カテゴリ / タグとの紐付けを運ぶようにした版。旧版も読み込める（1: 紐付けなし） */
export const MASTER_FILE_VERSION = 2;
export const SUPPORTED_MASTER_FILE_VERSIONS: readonly number[] = [1, 2];
/** 実体は JSON だが、他アプリで開かせないため独自の拡張子にする */
export const MASTER_FILE_EXTENSION = '.tallia';

/** 移し替えファイル内の画像。JSON に載せるため base64 文字列にする */
export interface MasterFileImage {
  /** base64（データ URL ではなく本体のみ） */
  data: string;
  type: string;
  width: number;
  height: number;
}

/** ケースマスタの 1 行。表示順は配列の並びで表す */
export interface MasterFileCase {
  name: string;
  note?: string;
}

/**
 * オブジェクトマスタの 1 行。
 *
 * カテゴリ / タグは ID ではなく名前で参照する。ここに出てくる名前は
 * `MasterFile.categories` / `tags` にも必ず含まれる（読み込み時に補われる）。
 * version 1 のファイルには `category` / `tags` が存在しない。
 */
export interface MasterFileObject {
  name: string;
  /** → `MasterFile.categories` の要素。未設定なら省略する */
  category?: string;
  /** → `MasterFile.tags` の要素。空配列可 */
  tags?: string[];
  note?: string;
  image?: MasterFileImage;
}

/**
 * `.tallia` ファイルの中身。
 *
 * `categories` / `tags` は名前だけの配列で、並びがそのまま表示順になる。
 * どのオブジェクトからも参照されていないものも含めて全件を載せる。
 * オブジェクトからの紐付けは、この配列に載った名前で表す。
 */
export interface MasterFile {
  format: typeof MASTER_FILE_FORMAT;
  version: number;
  exportedAt: IsoDateTime;
  /** 取り込み画面に「どこから書き出したファイルか」を出すためだけの情報 */
  source: { projectName: string };
  cases: MasterFileCase[];
  categories: string[];
  tags: string[];
  masters: MasterFileObject[];
}
