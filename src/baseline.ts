import { hashBody } from './utils';

interface FileRef {
  path: string;
}

/**
 * パス → 本文のハッシュ。「この端末のユーザーが書いたものではない、最後に確認した本文」を表す。
 * 起動をまたいで残す必要が無く、保存すると同期の競合の原因になるため、メモリにだけ持つ。
 * 本文が空（または読めない）の時は、記録しない。
 */
export class BaselineStore<F extends FileRef = FileRef> {
  private readonly hashes = new Map<string, string>();

  constructor(private readonly readContent: (file: F) => Promise<string | null>) {}

  /** 今の本文を基準として記録する */
  async record(file: F): Promise<void> {
    const content = await this.readContent(file);
    if (content) {
      this.hashes.set(file.path, hashBody(content));
    }
  }

  /**
   * 基準が無いファイルだけ、今の本文を記録する。
   * 記録が無いと、未編集でも最初の保存で必ず更新対象になってしまうため。
   */
  async ensure(file: F): Promise<void> {
    if (!this.hashes.has(file.path)) {
      await this.record(file);
    }
  }

  /** 基準があるファイルだけ、今の本文に合わせ直す（外部からの編集を取り込む） */
  async refreshIfTracked(file: F): Promise<void> {
    if (this.hashes.has(file.path)) {
      await this.record(file);
    }
  }

  /** 基準があり、本文が基準と同じなら true */
  isUnchanged(file: FileRef, content: string): boolean {
    const baseline = this.hashes.get(file.path);
    return baseline !== undefined && hashBody(content) === baseline;
  }

  // フォルダの改名では子ファイルの基準が残らないが、次に開いた時に作り直されるので問題ない
  move(oldPath: string, newPath: string): void {
    const hash = this.hashes.get(oldPath);
    if (!hash) {
      return;
    }
    this.hashes.set(newPath, hash);
    this.hashes.delete(oldPath);
  }

  delete(path: string): void {
    this.hashes.delete(path);
  }
}
