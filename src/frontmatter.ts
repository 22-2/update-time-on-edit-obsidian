import { getFrontMatterInfo, type Editor } from 'obsidian';
import { formatDate, parseDate, shouldUpdateValue, type DateValue } from './utils';

export type FrontMatter = Record<string, unknown>;

export interface TimestampOptions {
  dateFormat: string;
  headerCreated: string;
  headerUpdated: string;
  minMinutesBetweenSaves: number;
  // created を未設定の時に追加するか（無効化や除外フォルダの判定は呼び出し側で行う）
  addCreated: boolean;
}

export type TimestampResult = 'updated' | 'up-to-date';

// frontmatter の値のうち、日付として解釈できる型だけを取り出す
function toDateValue(value: unknown): DateValue | undefined {
  if (value instanceof Date || typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  return undefined;
}

/**
 * frontmatter に created / updated を書き込む。
 * updated は、値が無い・日付として読めない・前回から最小間隔を過ぎている場合に書く。
 */
export function applyTimestamps(
  frontmatter: FrontMatter,
  times: { ctime: number; mtime: number },
  options: TimestampOptions,
): TimestampResult {
  const mTime = new Date(times.mtime);
  const cTime = new Date(times.ctime);

  if (!frontmatter[options.headerCreated] && options.addCreated) {
    frontmatter[options.headerCreated] = formatDate(cTime, options.dateFormat);
  }

  const currentUpdated = parseDate(toDateValue(frontmatter[options.headerUpdated]), options.dateFormat);
  const isUpToDate =
    frontmatter[options.headerUpdated] &&
    currentUpdated &&
    !shouldUpdateValue(mTime, currentUpdated, options.minMinutesBetweenSaves);
  if (isUpToDate) {
    return 'up-to-date';
  }

  frontmatter[options.headerUpdated] = formatDate(mTime, options.dateFormat);
  return 'updated';
}

/**
 * カーソルがフロントマター（閉じの --- の行まで）の中にあるか。
 * metadataCache の位置は入力中に古い値を返し得るため、エディターの今の内容から判定する。
 */
export function isCursorInFrontmatter(editor: Pick<Editor, 'getValue' | 'getCursor' | 'posToOffset'>): boolean {
  const { exists, contentStart } = getFrontMatterInfo(editor.getValue());
  return exists && editor.posToOffset(editor.getCursor()) < contentStart;
}
