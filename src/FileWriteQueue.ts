import PQueue from 'p-queue';
import writeFileAtomic from 'write-file-atomic';
import { debounce } from 'obsidian';

interface QueuedWrite {
  filePath: string;
  content: string;
  encoding?: BufferEncoding;
}

/**
 * FileWriteQueue はファイル書き込みをデバウンス＆直列化してFileLocked問題を緩和します。
 * - debounce：同一ファイルへの連続更新を短時間でまとめて1回の書き込みにする
 * - p-queue：複数ファイルの書き込みを concurrency=1 で直列化
 * - write-file-atomic：一時ファイル→rename で原子的に書き換える
 */
export class FileWriteQueue {
  private readonly queue = new PQueue({ concurrency: 1 });
  private readonly pendingWrites = new Map<string, QueuedWrite>();
  private readonly debouncedFlushInternal: () => void;
  private readonly DEBOUNCE_DELAY_MS = 500; // ファイル単位でのデバウンス遅延

  constructor() {
    // debounce でファイル単位の書き込みをまとめる
    // 複数ファイルの更新は別々のタイマーで管理されるため、キューが処理する
    this.debouncedFlushInternal = debounce(
      () => this.flushInternal(),
      this.DEBOUNCE_DELAY_MS,
      true,
    );
  }

  /**
   * ファイルをキューに追加（デバウンス済み）
   * @param filePath 書き込み対象ファイルパス
   * @param content ファイル内容
   * @param encoding エンコーディング（デフォルト: utf8）
   */
  public enqueue(filePath: string, content: string, encoding: BufferEncoding = 'utf8'): void {
    this.pendingWrites.set(filePath, { filePath, content, encoding });
    this.debouncedFlushInternal();
  }

  /**
   * 全待機中の書き込みをキューに流す（内部）
   * キューは concurrency=1 で直列処理
   */
  private async flushInternal(): Promise<void> {
    const writes = Array.from(this.pendingWrites.values());
    this.pendingWrites.clear();

    for (const write of writes) {
      await this.queue.add(() => this.writeFile(write));
    }
  }

  /**
   * 実際のファイル書き込み（atomic）
   */
  private async writeFile(write: QueuedWrite): Promise<void> {
    try {
      // write-file-atomic: 一時ファイル → rename で原子的に置き換え
      // これにより Nextcloud 同期クライアントの部分読み込みロックを軽減
      await writeFileAtomic(write.filePath, write.content, {
        encoding: write.encoding,
      });
    } catch (error) {
      console.error(`[FileWriteQueue] Failed to write ${write.filePath}:`, error);
      throw error;
    }
  }

  /**
   * 全キュー処理の完了を待つ（プラグイン終了時など）
   */
  public async flushAndWait(): Promise<void> {
    await this.flushInternal();
    await this.queue.onIdle();
  }

  /**
   * キューの状態をリセット（テスト用）
   */
  public clear(): void {
    this.pendingWrites.clear();
  }
}
