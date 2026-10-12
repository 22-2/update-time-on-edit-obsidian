# 改善計画：ハッシュのメモリ化と周辺の整理

作成日：2026-10-13（ブランチ `momon`、`f30b629` 時点）

## 目的

1. `fileHashMap` を `data.json` から外して、ファイルの数だけ大きくなる設定ファイルと、同期での FileLocked・競合の原因を無くす。
2. 使われていないコードと、その結果不要になる処理を削除する。
3. 除外判定の高速化、非推奨 API の置き換え、細かい不具合の修正。

## 決めたこと

| 項目 | 決定 | 理由 |
|---|---|---|
| ハッシュの保存先 | **メモリのみ**（`Map`）。起動をまたいで残さない | 基準はファイルを開いた時点で作れるので、起動をまたぐ必要が薄い。IndexedDB は実装と移行の手間に見合わない。プラグインのフォルダの JSON は、Obsidian Sync では同期されない（v1.6 以降、同期対象は `data.json`・`main.js`・`styles.css`・`manifest.json` のみ）が、Nextcloud などの外部同期では同期されてしまう |
| 全ファイルの一括更新（`UpdateAllModal`） | 削除 | どこからも開けず、今後も使わない |
| 「Fill initial cache」（`UpdateAllCacheData`） | 削除 | ハッシュを保存しないので意味が無くなる |
| 「Enable hash matcher」の設定 | 残す（キー名 `enableExperimentalHash` も互換のため維持） | 無効にしたい利用者のため。説明文だけ実態に合わせる |

## ハッシュの新しい仕組み

### 状態

`main.ts` にプライベートな `Map<string, string>`（パス → 本文のハッシュ）を持つ。名前は `baselineHashes` とする。
「基準」とは、**この端末のユーザーが書いたものではない、最後に確認した本文**を指す。

### 基準を記録・更新する場面

| 場面 | 処理 | 備考 |
|---|---|---|
| `file-open` | 記録が無ければ、今の本文で記録 | 今の `ensureBaselineCache` と同じ |
| `onLayoutReady` | アクティブなファイルについて、上と同じ処理 | 起動時に復元されたタブで `file-open` が発火するかは未確認。記録が無い時だけ書き込むので、二重に呼ばれても害は無い |
| ユーザー入力の無い `modify`（外部からの編集） | 記録があれば、新しい本文で上書き | **新規**。同期で本文が変わった後に、プロパティだけの編集で更新されてしまう穴を塞ぐ |
| フロントマターの更新が成功した後 | 今の本文で記録 | 今の `populateCacheForFile` と同じ |
| `rename` | 記録を新しいパスへ移す | フォルダの改名で子ファイルの記録が消えても、次に開いた時に作り直されるだけなので問題ない |
| `delete` | 記録を消す | |

`enableExperimentalHash` が無効の時は、どの場面でも記録しない（今と同じ）。

### 外部からの編集の判定

今の `isValidActiveFile` は、外部からの編集もそれ以外の理由（非フォーカス、別のファイルがアクティブなど）もまとめて `false` を返す。基準の上書きは「本来なら対象になるファイルで、ユーザー入力だけが無い」場合に限りたいので、判定を分ける。

```ts
// 案：modify ハンドラー
(file) => {
  if (!isFile(file) || this.isInvalidFile(file)) return;
  if (!this.hasRecentUserInput()) {
    void this.refreshBaselineIfTracked(file); // 記録がある時だけ上書き
    return;
  }
  if (!this.isValidActiveFile(file)) return;
  this.scheduleIdleUpdate(file);
}
```

### 既存データの移行

`loadSettings` で読み込んだデータに `fileHashMap` があれば、そのキーを削除して一度だけ保存する。型からも `fileHashMap` を消す。

### 既知の制限

- ユーザーの編集が（フォーカスが外れるなどで）まだ更新日時に反映されていないうちに外部からの編集が来ると、基準がその本文で上書きされ、ユーザーの編集が更新日時に反映されなくなる。今でも予約が取り消された更新は反映されないので、悪化の幅は小さいと判断する。
- 起動直後に、記録の無いファイルを開かずに編集する手段は無い（`modify` はアクティブなファイルしか扱わない）ので、記録が無い時の扱いは今と同じ「比較しない（更新する）」でよい。

## 作業手順

各手順でテストと lint が通る状態を保ち、手順ごとにコミットする。コミットメッセージは `my-conventional-commits` に従い、実装時に差分を見て決める（下の type は目安）。

### 手順 1：一括処理のモーダルを削除する（`refactor`）

- `src/UpdateAllModal.ts`・`src/UpdateAllCacheData.ts` を削除
- `Settings.ts` から「Initial cache」の項目、`openInitialCacheModal`、import を削除
- `main.ts`
  - `getAllFilesPossiblyAffected` を削除
  - 呼び出し元が `modify` だけになるので、`triggerSource` 引数（`'modify' | 'bulk'`）を削除し、常に `modify` 用の確認を行う
  - 使われていない `getIgnoreFolders` を削除
- `styles.css` から使われなくなるクラスを削除：`.update-time-on-edit--bulk-modal`、`.update-time-on-edit--settings--warn`、`.time_search`（どこからも参照されていない）
- `main.test.ts` の `handleFileChange(s.file, 'bulk')` を削除

元の改善案の 4（モーダルで全ファイルを 2 回読む）と 8（モーダルの重複）は、この手順で対象ごと無くなる。

### 手順 2：ハッシュをメモリに移す（`refactor`、利用者への影響があるので本文に記載）

- 上の「ハッシュの新しい仕組み」を実装
- `fileHashMap` を型・既定値・テストのモックから削除し、移行処理を追加
- `populateCacheForFile` → `recordBaseline`、`ensureBaselineCache` → `ensureBaseline` のように、保存しないことが分かる名前に変える
- `handleFileRename`・`handleFileDelete` を `Map` の操作に変える。`handleFileDelete` は `async` をやめる
- 保存するものが設定だけになるので、`debouncedSaveSettings`・`saveSettingsBatched` を削除し、Obsidian の `debounce` の import も外す
- 「Enable hash matcher」の説明文を、今の動作（開いた時点の本文と比べる）に合わせて書き直す
- `update.md` の「設定保存の抑制」の節を更新

テストに追加すること：

- 開いた時点から本文が変わっていなければ更新しない
- 外部からの編集の後、プロパティだけを変えても更新しない
- 改名した後も基準が引き継がれる
- 読み込んだデータに `fileHashMap` があれば削除して保存する

### 手順 3：除外判定を速くする（`perf`）

- `shouldFileBeIgnored` の順番を、読み込みの要らない判定が先になるよう変える
  1. `isInvalidFile`
  2. `isExcalidrawFile`
  3. `isFileInIgnoredFolder`
  4. 本文の読み込み（空なら除外）
  5. 基準との比較
- `utils.ts` の `isPathIgnored` は、パターンを改行でつないだ文字列をキーにして、`ignore()` の判定オブジェクトを使い回す（直前の 1 件だけ持てば十分）。設定画面のプレビュー（`filterIgnoredFolders`）も同じ仕組みを使う
- `shouldIgnoreCreated` と `isFileInIgnoredFolder` の重複した処理をまとめる

### 手順 4：非推奨 API と型キャストをやめる（`refactor`）

- `workspace.activeLeaf?.view.containerEl.ownerDocument`（2 か所）を `workspace.getActiveViewOfType(MarkdownView)?.containerEl.ownerDocument` に置き換え、共通のメソッドにまとめる
  - 今の判定はアクティブなタブがマークダウンでなくても通るが、更新対象はマークダウンのファイルだけなので、絞っても動作は変わらないはず。実装時に、ポップアウトでの編集で確かめる
- `utils.ts` の `isFile`・`isTFile`（中身が同じ）を削除し、`instanceof TFile` に統一する。`createActiveFileGuard` の `as TFile` も不要になる
- テスト用のモック（`test/obsidian.ts`）に `TFile`・`MarkdownView` のクラスを追加し、`main.test.ts` のファイルをそのクラスから作る。`workspace.getActiveViewOfType` もモックに加える

### 手順 5：フロントマター終端の判定を直す（`fix`）

- `getCursorAfterFrontmatter` は `startsWith('---')` で判定しているので、`----` のような水平線や `---foo` も区切りと見なしてしまう
- 行の配列から終端の行番号を返す純粋な関数を `utils.ts` に作り、区切りは `/^---[ \t]*$/`（`stripFrontmatter` と同じ）で判定する。単体テストを `utils.test.ts` に追加する
- `metadataCache` の `frontmatterPosition` は、入力中に古い値を返し得るため使わない。エディターの今の内容から判定する
- あわせて `shouldSkipWhenCursorInFrontmatter` のインデントの崩れを直す

### 手順 6：細かい整理（`refactor`）

- `updateModifiedField`：値が無い場合と期限切れの場合の書き込みを一つの条件にまとめる
- `update.md`・`.todo` を最終的な状態に合わせて更新

## 確認方法

- 各手順で `pnpm exec vitest run`・`pnpm lint`・`pnpm build`
- 手順 2・4 の後に、実際の保管庫で次を確かめる
  - 起動直後に開いているファイルで、何も変えずに保存しても `updated` が変わらない（`file-open` が起動時に発火するかもここで確認）
  - 本文を編集すると、3 秒ほどで `updated` が変わる
  - 外部のエディターで本文を書き換えた後、Obsidian でプロパティだけを変えても `updated` が変わらない
  - ポップアウトのウィンドウで編集しても更新される
  - `data.json` から `fileHashMap` が消えている

## 元の改善案との対応

| 元の番号 | 内容 | この計画での扱い |
|---|---|---|
| 1 | `UpdateAllModal` が使われていない | 手順 1 で削除 |
| 2 | `fileHashMap` を `data.json` に入れている | 手順 2 でメモリ化 |
| 3 | 除外判定の前に本文を読む・判定オブジェクトを毎回作る | 手順 3 |
| 4 | モーダルが全ファイルを 2 回読む | 手順 1 でモーダルごと削除 |
| 5 | 非推奨の `activeLeaf` | 手順 4 |
| 6 | `isFile`・`isTFile` の重複と型キャスト | 手順 4 |
| 7 | フロントマター終端の判定が緩い | 手順 5 |
| 8 | モーダル 2 つの重複 | 手順 1 でモーダルごと削除 |
| 細かい所 | `updateModifiedField`・`handleFileDelete`・インデント・CSS | 手順 2・5・6。独自の色（`#ff5a5a`）は、使っていたクラスごと手順 1 で消える |
