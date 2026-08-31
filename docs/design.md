# Tallia 詳細設計書

このドキュメントは実装エージェント向けの仕様書です。ここに書かれた決定事項は確定済みであり、
再検討や代替案の提案は不要です。不明点がある場合のみ、実装を止めて質問してください。

---

## 1. 概要

### 1.1 目的

**Tallia**（リポジトリ名: `tallia`）は、ゲームのタイトルごとに、ゲーム内オブジェクト（アイテム、素材、モンスターなど）の
所持数・配置状況を記録するための個人用メモツール。

### 1.2 前提条件

- 個人の趣味用ツール。有料化・商用利用はしない
- 認証機能を持たない。ユーザーという概念自体が存在しない
- サーバーサイドを持たない完全な静的サイト。外部への通信は一切行わない
- データはすべて利用者のブラウザ内（IndexedDB）に保存する
- GitHub の public リポジトリで公開し、GitHub Pages でホストする

### 1.3 スコープ外

以下は今回実装しない。将来的な拡張余地として構造だけ壊さないようにする。

- 画像・添付ファイルの保存
- 端末間同期、クラウドバックアップ
- 認証、マルチユーザー
- AI 連携機能
- 課金、決済

---

## 2. 技術スタック

| 項目           | 選定                             | 補足                                                        |
| -------------- | -------------------------------- | ----------------------------------------------------------- |
| フレームワーク | Angular（最新安定版）            | standalone components + Signals を使用。NgModule は使わない |
| 言語           | TypeScript（strict）             | `any` 禁止。`strictNullChecks` 有効                         |
| ビルド         | Angular CLI（内部 esbuild/Vite） |                                                             |
| ストレージ     | IndexedDB                        | ラッパーに `idb` を使用                                     |
| PWA            | `@angular/pwa`                   | Angular 標準の Service Worker                               |
| スタイル       | SCSS                             | UI ライブラリは導入しない                                   |
| ID 生成        | `crypto.randomUUID()`            | 標準 API。外部依存を追加しない                              |
| ホスティング   | GitHub Pages                     | プロジェクトサイト（サブパス配信）                          |

### 2.1 選定理由（変更不可の前提）

- **Angular**: 開発者の習熟度が最も高い。DI によるレイヤ分離を設計の中心に据える
- **IndexedDB**: 想定最大規模（後述）で localStorage の容量上限を超えるため
- **`crypto.randomUUID()`**: nanoid 等の外部パッケージを避けるため。ID 長は問題にしない

---

## 3. データモデル

### 3.1 概念

```
Project（ゲームタイトル）
  ├─ Master（そのタイトルに登場するオブジェクトの定義）
  └─ Case（記録の単位：ダンジョン、章、周回など）
        └─ Instance（そのケースに何がいくつあるか）
```

- **Master** はオブジェクトの「種類」を定義する。名前や共通属性はここにのみ持つ
- **Instance** は「どのケースに、どのマスターが、いくつあるか」を表す
- Instance は **数量型**。同一ケース内の同一マスターは 1 レコードに集約し `qty` で数を持つ
- 全エンティティをフラットに保持し、親子関係は外部キー + インデックスで表現する。
  ネストした配列構造は使わない

### 3.2 型定義

`src/app/core/db/schema.ts` に配置する。

```ts
/** ISO 8601 形式の日時文字列（例: "2026-08-31T12:00:00.000Z"） */
export type IsoDateTime = string;

export interface Project {
  id: string; // crypto.randomUUID()
  name: string; // ゲームタイトル名
  note?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface Case {
  id: string;
  projectId: string; // → Project.id
  name: string;
  note?: string;
  order: number; // 表示順。同一プロジェクト内で連番
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface Master {
  id: string;
  projectId: string; // → Project.id
  name: string;
  category?: string; // 任意の分類（武器 / 素材 など）
  tags: string[]; // 空配列可
  note?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface Instance {
  id: string;
  projectId: string; // → Project.id（横断検索用に冗長保持）
  caseId: string; // → Case.id
  masterId: string; // → Master.id
  qty: number; // 1 以上の整数
  note?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
```

**日時は必ず ISO 文字列で保存する。`Date` オブジェクトを保存しないこと。**
IndexedDB は `Date` を保存できるが、JSON エクスポート時に変換処理が必要になるため。

### 3.3 IndexedDB スキーマ

- データベース名: `tallia`
- 初期バージョン: `1`

| ストア      | keyPath | インデックス                                                                                                                      |
| ----------- | ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `projects`  | `id`    | なし                                                                                                                              |
| `cases`     | `id`    | `by-project` (`projectId`)                                                                                                        |
| `masters`   | `id`    | `by-project` (`projectId`)<br>`by-project-name` (`[projectId, name]`)                                                             |
| `instances` | `id`    | `by-project` (`projectId`)<br>`by-case` (`caseId`)<br>`by-master` (`masterId`)<br>`by-case-master` (`[caseId, masterId]`, unique) |

`by-case-master` は **unique 制約付き**。数量型の一意性をストア側で担保する。

`upgrade` コールバック内でストアとインデックスをすべて定義すること。
後からインデックスを追加する場合は DB バージョンを上げる必要があるため、
上記は初期バージョンで全部作る。

### 3.4 整合性ルール

| 操作                                      | 挙動                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| Project 削除                              | 配下の Case / Master / Instance をすべてカスケード削除                  |
| Case 削除                                 | 配下の Instance をカスケード削除                                        |
| Master 削除                               | 参照している Instance が 1 件でもあれば**削除を拒否**し、使用件数を返す |
| Instance 追加（既存の caseId + masterId） | 新規作成せず既存レコードの `qty` に加算                                 |
| `qty` が 0 以下になる更新                 | レコードを削除する                                                      |

カスケード削除は必ず**単一トランザクション内**で実行すること。

### 3.5 想定規模

| 指標                         | 想定最大 |
| ---------------------------- | -------- |
| Project 数                   | 10       |
| 1 Project あたり Case 数     | 50       |
| 1 Project あたり Master 数   | 100      |
| 1 Case あたり Instance 数    | 100      |
| 1 Project あたり Instance 数 | 5,000    |
| 全体 Instance 数             | 50,000   |

全体で 15MB 程度。IndexedDB の容量上限に対しては十分小さいため、
アプリ側で件数制限やサイズ制限は設けない。

ただし**起動時に全 Instance を読み込まないこと**。表示中のプロジェクト、
表示中のケースの範囲だけをインデックス経由で取得する。

---

## 4. アーキテクチャ

### 4.1 レイヤ構成

```
Component（表示・入力のみ）
    ↓ 呼び出し
Service（業務ロジック、整合性ルール、状態管理）
    ↓ 呼び出し
Repository（IndexedDB の CRUD のみ）
    ↓
IndexedDB
```

**厳守事項:**

- Component から Repository を直接呼ばない
- Repository は業務ルール（カスケード削除、qty 加算など）を持たない。純粋な永続化のみ
- Repository は Angular に依存する記述を持たない（`@Injectable()` は付けるが、
  それ以外の Angular API は使わない）。将来の移植性のため
- Service が整合性ルールとトランザクション境界を担当する

### 4.2 ディレクトリ構成

```
src/app/
├── core/
│   ├── db/
│   │   ├── schema.ts              # 型定義
│   │   └── database.ts            # openDB / upgrade 定義
│   ├── repositories/
│   │   ├── project.repository.ts
│   │   ├── case.repository.ts
│   │   ├── master.repository.ts
│   │   └── instance.repository.ts
│   └── services/
│       ├── project.service.ts
│       ├── case.service.ts
│       ├── master.service.ts
│       ├── instance.service.ts
│       ├── backup.service.ts      # エクスポート / インポート
│       └── app-update.service.ts  # SwUpdate 監視
├── features/
│   ├── project-list/
│   ├── project-menu/              # プロジェクト内のメニュー
│   ├── case-overview/             # ケース展開ビュー
│   ├── case-list/                 # ケースマスタ
│   ├── case-detail/
│   ├── master-list/               # オブジェクトマスタ
│   └── settings/
└── shared/
    ├── components/
    └── utils/
        └── id.ts                  # newId() = crypto.randomUUID()
```

すべて `providedIn: 'root'` の Injectable として登録し、`inject()` 関数で注入する。
コンストラクタインジェクションではなく `inject()` を使うこと。

### 4.3 状態管理

- Signals を使用する。NgRx 等の状態管理ライブラリは導入しない
- 各 Service が対象エンティティの Signal を保持し、Component は `computed` で読む
- 更新は Service のメソッド経由でのみ行い、Component から Signal を直接書き換えない

---

## 5. Repository 層 API

各メソッドは Promise を返す。以下はシグネチャの定義であり、実装は `idb` を使う。

```ts
// project.repository.ts
getAll(): Promise<Project[]>
getById(id: string): Promise<Project | undefined>
put(project: Project): Promise<void>
delete(id: string): Promise<void>

// case.repository.ts
getByProject(projectId: string): Promise<Case[]>
getById(id: string): Promise<Case | undefined>
put(c: Case): Promise<void>
delete(id: string): Promise<void>
deleteByProject(projectId: string): Promise<void>

// master.repository.ts
getByProject(projectId: string): Promise<Master[]>
getById(id: string): Promise<Master | undefined>
findByName(projectId: string, name: string): Promise<Master | undefined>
put(m: Master): Promise<void>
delete(id: string): Promise<void>
deleteByProject(projectId: string): Promise<void>

// instance.repository.ts
getByCase(caseId: string): Promise<Instance[]>
getByMaster(masterId: string): Promise<Instance[]>
getByProject(projectId: string): Promise<Instance[]>
findByCaseAndMaster(caseId: string, masterId: string): Promise<Instance | undefined>
put(i: Instance): Promise<void>
delete(id: string): Promise<void>
deleteByCase(caseId: string): Promise<void>
deleteByProject(projectId: string): Promise<void>
countByMaster(masterId: string): Promise<number>
```

---

## 6. Service 層の主要ロジック

### 6.1 InstanceService.addToCase()

```
addToCase(caseId, masterId, qty = 1):
  1. findByCaseAndMaster(caseId, masterId) で既存を検索
  2. 存在する → qty を加算し updatedAt を更新して put
  3. 存在しない → 新規 Instance を作成して put
  4. qty が 0 以下になった場合は delete
```

### 6.2 MasterService.delete()

```
delete(masterId):
  1. countByMaster(masterId) で使用件数を取得
  2. 0 件でなければ MasterInUseError を投げる（件数を含める）
  3. 0 件なら削除
```

UI 側はこのエラーを捕捉し、「このオブジェクトは N 件のケースで使用中のため削除できません」
と表示する。

### 6.3 ProjectService.delete()

```
delete(projectId):
  単一トランザクションで
  instances → cases → masters → project の順に削除する
```

---

## 7. 画面仕様

### 7.1 ルーティング

**HashLocationStrategy を使用する。** GitHub Pages で 404.html 対策を不要にするため。

| パス                                 | 画面                               |
| ------------------------------------ | ---------------------------------- |
| `/`                                  | プロジェクト一覧                   |
| `/projects/:projectId`               | プロジェクトメニュー               |
| `/projects/:projectId/overview`      | ケースとオブジェクトの一覧         |
| `/projects/:projectId/cases`         | ケースマスタ                       |
| `/projects/:projectId/cases/:caseId` | ケース詳細（インスタンス一覧）     |
| `/projects/:projectId/masters`       | オブジェクトマスタ（マスター一覧） |
| `/settings`                          | 設定（エクスポート / インポート）  |

存在しない ID にアクセスした場合は一覧へリダイレクトする。

### 7.2 各画面の要件

**プロジェクト一覧**

- 登録済みプロジェクトをカード形式で表示。名前、ケース数、マスター数を出す
- カード全体をプロジェクトメニューへの導線にする。編集・削除はカード上のアイコンボタンに置き、
  カード全面のリンクより手前に重ねる（タップ領域は 44px 角以上）
- 新規作成、名前変更、削除
- 削除時は「配下のデータもすべて削除されます」と件数付きで確認する
- 0 件のときは空状態を表示し、作成を促す

**プロジェクトメニュー**

- プロジェクト名・イメージ画像・メモを出し、以下 3 つへの導線だけを置く
  - ケースとオブジェクトの一覧
  - ケースマスタ（ケース数を併記）
  - オブジェクトマスタ（オブジェクト数を併記）
- 件数はインデックスの `count` だけで取り、インスタンスは読み込まない

**ケースとオブジェクトの一覧**

- ケースを `order` 順に展開ビューとして並べる。行にはケース名と合計数を出す
- 行を開くとそのケースのインスタンスを一覧表示する（サムネイル・名前・カテゴリ・タグ・個数）
- インスタンスは開かれたケースの分だけ `by-case` インデックスで読み、一度読んだ分はページ内で保持する
- 展開状態は `aria-expanded` / `aria-controls` で表す
- 個数の編集はここでは行わず、ケース詳細への導線を置く

**ケースマスタ**

- ケースを `order` 順に一覧表示。各ケースのインスタンス合計数を出す
- ケースの追加、名前変更、削除、並び替え

**オブジェクトマスタ（マスター一覧）**

- そのプロジェクトのマスターを一覧表示。名前、カテゴリ、タグ、使用ケース数
- 名前・カテゴリ・タグでの絞り込み
- 追加、編集、削除。編集・削除はアイコンボタン（タップ領域は 44px 角以上）
- 各マスターについて「どのケースで使われているか」を展開表示できる

**ケース詳細（インスタンス一覧）**

- そのケースに登録されたインスタンスを一覧表示。マスター名と `qty`
- マスターを選んで追加する。既存分があれば自動で加算される
- `qty` の増減、削除
- マスター名で絞り込み

**設定**

- JSON エクスポート、JSON インポート
- `navigator.storage.estimate()` による使用量表示
- 全データ削除（二段階確認）

### 7.3 UI 方針

- モバイルでも操作できるレスポンシブ対応
- 一覧は `@for` の `track` を必ず指定する
- キーボードフォーカスを視認できるようにする
- 破壊的操作（削除）は必ず確認を挟む
- 空状態は「何をすればいいか」を書く。「データがありません」だけにしない
- エラーメッセージは何が起きたかと次に何をすべきかを書く

視覚デザインの詳細は実装者の裁量とするが、UI ライブラリは導入せず SCSS で自作すること。

---

## 8. エクスポート / インポート

### 8.1 フォーマット

```json
{
  "format": "tallia-backup",
  "version": 1,
  "exportedAt": "2026-08-31T12:00:00.000Z",
  "projects": [],
  "cases": [],
  "masters": [],
  "instances": []
}
```

- `version` は必須。将来スキーマを変更した際の移行処理の分岐点になる
- 読み込み時は `format` と `version` を必ず検証し、不一致ならエラーにする
- 各配列にはストアのレコードをそのまま入れる（変換しない）

### 8.2 エクスポート

- 全プロジェクトの一括エクスポートと、プロジェクト単位のエクスポートを両方用意する
- プロジェクト単位の場合、そのプロジェクトに属するレコードのみを含める
- `Blob` + `URL.createObjectURL` でダウンロードさせる
- ファイル名: `tallia-{YYYYMMDD-HHmmss}.json`
  （プロジェクト単位なら `tallia-{プロジェクト名}-{日時}.json`）
- 生成した Object URL は `revokeObjectURL` で必ず解放する

### 8.3 インポート

`<input type="file" accept="application/json">` で読み込む。以下の 2 モードを用意する。

| モード   | 挙動                                                                               |
| -------- | ---------------------------------------------------------------------------------- |
| **追加** | すべての ID を新規採番し直し、別プロジェクトとして追加する。既存データは変更しない |
| **置換** | 既存の全データを削除してからファイルの内容を投入する。二段階確認を必須とする       |

「追加」モードでは、ID を振り直す際に外部キー（`projectId` / `caseId` / `masterId`）も
新旧 ID の対応表を使って一貫して差し替えること。ここを間違えると参照が壊れる。

インポートは単一トランザクションで実行し、途中で失敗した場合はロールバックする。

---

## 9. PWA

### 9.1 セットアップ

```
ng add @angular/pwa
```

### 9.2 Service Worker 設定（`ngsw-config.json`）

- アプリシェル（HTML / JS / CSS / アイコン）は `prefetch` でインストール時に取得
- データキャッシュ（`dataGroups`）は**設定しない**。外部通信を行わないため不要
- 完全オフラインで全機能が動作すること

### 9.3 マニフェスト

GitHub Pages のプロジェクトサイトはサブパス配信になるため、以下を必ず合わせる。

```json
{
  "name": "Tallia",
  "short_name": "Tallia",
  "start_url": "/tallia/",
  "scope": "/tallia/",
  "display": "standalone"
}
```

`start_url` と `scope` がサブパスと一致していないと、インストール後に正しく起動しない。

### 9.4 更新検知

`AppUpdateService` で `SwUpdate.versionUpdates` を購読し、
`VERSION_READY` を検知したら「新しいバージョンがあります」と再読み込みを促す UI を出す。
自動リロードはしない（編集中のデータを失う可能性があるため）。

### 9.5 ストレージ永続化

初回起動時に `navigator.storage.persist()` を呼ぶ。
拒否されても機能は継続する。結果に応じて設定画面に永続化の状態を表示する。

---

## 10. デプロイ

### 10.1 ビルド

```
ng build --base-href /tallia/
```

### 10.2 GitHub Actions

`.github/workflows/deploy.yml` を作成する。

- トリガー: `main` ブランチへの push
- Node.js のセットアップ → `npm ci` → build
- `actions/upload-pages-artifact` と `actions/deploy-pages` を使用する
- 出力ディレクトリ直下に `.nojekyll` を配置する（`_` 始まりのファイルが無視されるのを防ぐ）

### 10.3 リポジトリ設定

- Settings → Pages → Source を「GitHub Actions」にする

---

## 11. 非機能要件

### 11.1 パフォーマンス

- 起動時に読み込むのはプロジェクト一覧のみ
- ケース詳細では `by-case` インデックスで該当ケース分のみ取得する
- マスター一覧が数百件になりうるため、絞り込みは Signal の `computed` で行う
- 1 画面あたりの表示件数は数百件を想定。仮想スクロールは実装しない

### 11.2 エラー処理

- IndexedDB の操作失敗は握り潰さず、UI にエラーを表示する
- インポート時の JSON パース失敗、フォーマット不一致は明示的にメッセージを出す
- ブラウザが IndexedDB をサポートしない場合（プライベートモード等）は
  起動時に警告を表示する

### 11.3 テスト

- Repository 層は `fake-indexeddb` を使ったユニットテストを書く
- Service 層の整合性ルール（カスケード削除、qty 加算、削除拒否）は必ずテストする
- Component のテストは必須としない

---

## 12. 実装順序

1. Angular プロジェクト作成、strict 設定、ディレクトリ構成の雛形
2. `schema.ts` の型定義と `database.ts`（`openDB` + `upgrade`）
3. Repository 層 4 種 + ユニットテスト
4. Service 層（整合性ルールを含む）+ ユニットテスト
5. ルーティングと画面の骨組み（HashLocationStrategy）
6. プロジェクト一覧 → ケース一覧 → ケース詳細 の順に画面を実装
7. マスター一覧
8. エクスポート / インポート
9. PWA 化と更新検知
10. GitHub Actions によるデプロイ設定

各ステップは独立して動作確認できる状態にしてから次へ進むこと。

---

## 13. 確認が必要な事項

以下は実装開始前に依頼者へ確認すること。

1. **Master の共通属性**: 現在は `name` / `category` / `tags` / `note` としているが、
   実際のゲームデータで必要な属性があれば追加する
