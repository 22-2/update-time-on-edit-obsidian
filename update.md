# Update on edit - momon ブランチ変更点まとめ

`origin/main` からの分岐で 23 コミットが追加されています。
主な目的は **Nextcloud 同期時の FileLocked 問題の緩和** と **除外（ignore）機能の強化** です。

## 主な機能変更

### 1. ファイル書き込みの信頼性向上（FileLocked 対策）
- **`FileWriteQueue` の新設**（`src/FileWriteQueue.ts`）
  - `write-file-atomic`（一時ファイル→rename で原子的な書き込み）
  - `p-queue` で書き込みを concurrency=1 で直列化
  - Obsidian の `debounce` で同一ファイルへの連続書き込みを 500ms に集約
- **設定保存（`data.json`）をデバウンス**して高頻度な保存を 1 秒に 1 回に抑制
  - `saveSettingsBatched()` を導入し、`saveSettings()` の直接呼び出しを置換

### 2. 編集中のフロントマター更新制御
- `modify` イベントを 3 秒デバウンスしてから処理
- `editor-change` イベントを監視し、編集中（1.5 秒以内の編集）は更新を再延期するアイドル待ち方式に変更
- **設定 `skipFrontmatterWhenCursorInFrontmatter` を追加**
  - カーソルがフロントマター領域にある場合、フロントマターの更新をスキップ（編集中の YAML を壊さない）

### 3. 除外ルール（ignore）機能の強化
- `ignore` パッケージ（gitignore 互換）を導入し、**gitignore 風のパターン指定**（`!` による再包含、`#` コメント）に対応
- **`IgnoreRulesModal` の新設**（`src/IgnoreRulesModal.ts`）
  - パターン編集のテキストエリア
  - 実フォルダを収集して「監視対象 / 除外対象」をリアルタイムプレビュー
  - 共通プレフィックスでグルーピングした一覧表示
- 除外フォルダ設定 UI を検索+削除リスト形式からモーダル形式へ刷新

### 4. 日付処理を moment.js へ移行
- `date-fns` → グローバルに存在する **moment.js**（Obsidian 内蔵）を利用
- デフォルト形式を `yyyy-MM-dd'T'HH:mm` → `YYYY-MM-DDTHH:mm` に変更
- 厳密パースに失敗した場合は緩いパースでフォールバック

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
- テストを Jest → **Vitest** に移行（`src/utils.test.ts`）

## ビルド・ツール設定

- `esbuild.config.mjs` → **`esbuild.config.mts`** へ移行（TypeScript 化）
- `__DEV__` → `__DEV_MODE__` にリネーム（タイポ修正含む）
- esbuild の `target` を `esnext` に、`minify` を production 時のみ有効に設定
- tsconfig の `target` を `esnext` に変更
- `scripts` を `pnpm dlx tsx` 経由で実行するよう更新
- 依存関係を全体的に更新（`@types/node`, TypeScript, esbuild 等）

## 残タスク・既知事項（`.todo` より）

- [x] フォルダ変更の検知、編集中の除外（キー コマンディング）の対応
- [x] date-fns から moment.js への移行
- [x] data.json の更新頻度抑制
- [x] exclude 機能の強化
- 既知の制限：frontmatter の並べ替えが生じるのは `processFrontMatter` の仕様。テンプレートファイルへのヘッダー追記はプラグインの責務外
