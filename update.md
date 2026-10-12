# Update on edit - momon ブランチ変更点まとめ

`origin/main` からの分岐で 45 コミットが追加されています。
主な目的は **Nextcloud 同期時の FileLocked 問題の緩和** と **除外（ignore）機能の強化** で、
後半はビルド設定と依存関係の整理です。

## 主な機能変更

### 1. 設定保存の抑制（FileLocked 対策）
- **設定保存（`data.json`）をデバウンス**して高頻度な保存を 1 秒に 1 回に抑制
  - `saveSettingsBatched()` を導入し、`saveSettings()` の直接呼び出しを置換
- ファイル書き込みを直列化する `FileWriteQueue` を試作したが、実際の書き込みは
  `processFrontMatter` が行っており未使用だったため削除した

### 2. 編集中のフロントマター更新制御
- `modify` イベントを 3 秒デバウンスしてから処理
- `editor-change` イベントを監視し、編集中（1.5 秒以内の編集）は更新を再延期するアイドル待ち方式に変更
- **設定 `skipFrontmatterWhenCursorInFrontmatter` を追加**
  - カーソルがフロントマター領域にある場合、フロントマターの更新をスキップ（編集中の YAML を壊さない）

### 3. 更新してよい条件の厳密化
- Vault 外のファイルと、Obsidian が非フォーカスの時の編集では日時を更新しない
- 予約した更新の実行直前にも、フォーカスとアクティブファイルを再確認する
- ユーザー入力が無い外部編集（同期など）では更新日時を書き換えない
- ポップアウトウィンドウでの編集を、入力・フォーカス判定に反映する
- ハッシュ照合は **フロントマターを除く本文のみ** で行う（プロパティだけの変更で更新が動かないように）
- 開いたファイルのハッシュキャッシュが無い場合は、その時点の内容を基準として記録する

### 4. 除外ルール（ignore）機能の強化
- `ignore` パッケージ（gitignore 互換）を導入し、**gitignore 風のパターン指定**（`!` による再包含、`#` コメント）に対応
- **`IgnoreRulesModal` の新設**（`src/IgnoreRulesModal.ts`）
  - パターン編集のテキストエリア
  - 実フォルダを収集して「監視対象 / 除外対象」をリアルタイムプレビュー
  - 共通プレフィックスでグルーピングした一覧表示
- 除外フォルダ設定 UI を検索+削除リスト形式からモーダル形式へ刷新

### 5. 日付処理を moment.js へ移行
- `date-fns` を廃止し、Obsidian に内蔵の **moment.js** を利用
  - obsidian の型定義は moment を名前空間として公開しているため、`src/utils.ts` で使う範囲の関数型を定義して export している
- デフォルト形式を `yyyy-MM-dd'T'HH:mm` → `YYYY-MM-DDTHH:mm` に変更
- 厳密パースに失敗した場合は緩いパースでフォールバック

### 6. デバッグログを設定で切り替え
- `__DEV_MODE__`（ビルド時定数）を廃止し、設定 **Debug logging**（既定は無効）で切り替える
- 出力は `console.debug`。既定では出ず、設定を有効にした時だけ出力される

## バグ修正

- **一時ファイル "Untitled" を更新対象から除外**
  - 一時ファイル判定をパスではなく **ファイル名**（`Untitled` プレフィックス）で行うよう修正
- **共通プレフィックスでグルーピングする際、残りの全アイテムが処理されるよう修正**
  - 共通プレフィックスが見つからない場合、残りの要素を「プレフィックスなし」グループとして収集
- `Canvas.md` を除外判定から追加（キャンバス作成時の中身を壊す問題）

## リファクタリング・整理

- `src/main.ts` を機能ごとに分割リファクタリング（ガード、フィルタリング、処理、キャッシュ管理）
- 日付操作・ユーティリティを `src/utils.ts` に集約
- **使用していない設定の削除**
  - `enableNumberProperties`（数値プロパティ設定）を削除
  - `ignoreCreatedFolder`（created 用の個別除外設定）を削除し、`ignoreGlobalFolder` に一本化
- **未使用コードの削除**
  - `src/suggesters/`（Popper.js を使っていたサジェスト。どこからも import されていなかった）
  - `FileWriteQueue`（上記 1 を参照）
  - 内部だけで使われていた `export` の整理（`onlyUniqueArray`・`hashString`）
- テストを Jest → **Vitest** に移行（`src/utils.test.ts`、`src/main.test.ts`）
- `any` を使っていた箇所（frontmatter・moment・Excalidraw 判定）を実際の型に置き換え

## ビルド・ツール設定

- **obsidian-sample-plugin の最新テンプレート**に合わせた
  - `esbuild.config.mjs`（`esbuild.config.mts` から変更）
  - 出力は直下の `main.js`・`manifest.json`・`styles.css`。`dist/`・コピー処理・vault への同期（chokidar）を廃止
  - `styles.css` は lightningcss を通さずそのまま使う
  - ESLint 設定（`eslint-plugin-obsidianmd`）・`.editorconfig`・`.npmrc`・`version-bump.mjs`・`.gitignore`
  - CI（lint・release）は pnpm を使うように書き換え
- `pnpm build` は `tsc -noEmit -skipLibCheck` で型検査してから esbuild を実行する
- `tsconfig.json` は mobile-first-daily-interface の設定を基に、妥協していた2行（`erasableSyntaxOnly`・`strictPropertyInitialization`）を外した
- `obsidian-typings` は `@obsidian-typings/obsidian-public-latest` に移行
- **TypeScript は 6.x に固定**（typescript-eslint が TypeScript 7.0 にまだ対応しておらず、ESLint が起動できないため）
- 依存関係は `pnpm up --latest` で更新（`obsidian` 1.14、`vitest` 5、`@types/node` 26 など）
  - `obsidian` 1.13 以降は `Plugin.settings` が `unknown` 型のため、サブクラス側で `declare` して具体型を宣言
- **削除した依存**: `builtin-modules`・`chokidar`・`dotenv`・`esbuild-plugin-copy`・`fs-jetpack`・`lightningcss`・`write-file-atomic`・`date-fns`・`@popperjs/core`・`p-queue`・`atomically`・`tslib`、および `yarn.lock`
- **追加した依存**: ESLint 関連（`eslint`・`eslint-plugin-obsidianmd`・`typescript-eslint`・`globals`・`@eslint/js`・`jiti`）、`prettier`（既存の format スクリプトが参照していた）
- Node 組み込みモジュールは `node:` 接頭辞付きで書く（esbuild 設定では `node:process`・`node:module`）
- **最低対応バージョンを Obsidian 1.13.0 に引き上げ**（`manifest.json`）。設定画面は `getSettingDefinitions()` のみで実装し、旧版用の `display()` は削除した
  - `versions.json` は次のリリースで `pnpm version` が追記する（現在の 2.4.0 → 1.4.4 の記録はそのまま）

## lint の状況

- `pnpm lint`: error 0 件、warning 12 件（`main.ts` の `activeLeaf`・`TFile` キャスト、テストの `TFile` キャストとタイマー、テスト用モックの `globalThis`、`vitest.config.mts` の `node:url`）

## 残タスク・既知事項（`.todo` より）

- [x] フォルダ変更の検知、編集中の除外（キー コマンディング）の対応
- [x] date-fns から moment.js への移行
- [x] data.json の更新頻度抑制
- [x] exclude 機能の強化
- [x] 設定画面を `getSettingDefinitions()`（宣言的な設定 API）に移行し、`display()` を削除
- 既知の制限：frontmatter の並べ替えが生じるのは `processFrontMatter` の仕様。テンプレートファイルへのヘッダー追記はプラグインの責務外
