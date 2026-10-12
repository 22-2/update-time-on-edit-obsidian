import ignore, { type Ignore } from 'ignore';
import commonPathPrefix from 'common-path-prefix';
import { sha256 } from 'js-sha256';
import { App, moment as obsidianMoment, TFile } from 'obsidian';

interface MomentInstance {
  isValid(): boolean;
  toDate(): Date;
  format(format: string): string;
  add(amount: number, unit: 'minutes'): MomentInstance;
  isAfter(input: Date): boolean;
}

type MomentFactory = (input?: Date | number | string, format?: string, strict?: boolean) => MomentInstance;

export type DateValue = number | string | Date;

// obsidian の型定義は moment の名前空間を指し関数として呼べないため、使う範囲の型を与える
export const moment = obsidianMoment as unknown as MomentFactory;

function onlyUniqueArray<T>(value: T, index: number, self: T[]) {
  return self.indexOf(value) === index;
}

// ユーティリティ関数群
/**
 * 現在のファイルを取得します
 */
export function getActiveFile(app: App): TFile | null {
  return app.workspace.getActiveFile();
}
/**
 * 文字列をハッシュ化します
 */
function hashString(str: string): string {
  return sha256(str);
}
/**
 * 先頭のフロントマターを取り除いた本文を返します
 */
export function stripFrontmatter(content: string): string {
  return content.replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '');
}
/**
 * 本文（フロントマター除く）のハッシュを返します
 * プロパティだけの変更で更新日時が動かないよう、比較にはこちらを使う
 */
export function hashBody(content: string): string {
  return hashString(stripFrontmatter(content).trim());
}
/**
 * 日付をパースします
 */
export function parseDate(input: DateValue | undefined, dateFormat: string): Date | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (typeof input === 'string') {
    try {
      let m = moment(input, dateFormat, true);
      if (!m.isValid()) {
        m = moment(input);
      }
      if (!m.isValid()) {
        return undefined;
      }
      return m.toDate();
    } catch (e) {
      console.error(e);
      return undefined;
    }
  }
  return new Date(input);
}
/**
 * 日付をフォーマットします
 */
export function formatDate(input: Date, dateFormat: string): string {
  return moment(input).format(dateFormat);
}
/**
 * 更新すべきかどうかを判定します
 */
export function shouldUpdateValue(
  currentMtime: Date,
  updateHeader: Date,
  minMinutesBetweenSaves: number): boolean {
  const nextUpdate = moment(updateHeader).add(minMinutesBetweenSaves, 'minutes').toDate();
  return moment(currentMtime).isAfter(nextUpdate);
}
/**
 * Excalidrawファイルかどうかを判定します
 */
export function isExcalidrawFile(file: TFile): boolean {
  const ea = getExcalidrawAutomate();
  return ea ? ea.isExcalidrawFile(file) : false;
}

interface ExcalidrawAutomateLike {
  isExcalidrawFile(file: TFile): boolean;
}

// Excalidraw プラグインが起動していない場合は undefined になる
function getExcalidrawAutomate(): ExcalidrawAutomateLike | undefined {
  return (window as Window & { ExcalidrawAutomate?: ExcalidrawAutomateLike }).ExcalidrawAutomate;
}
/**
 * 無視フォルダー設定を正規化します
 */
export function normalizeIgnoreFolders(ignoreGlobalFolder: string | string[] | undefined): string[] {
  if (!ignoreGlobalFolder) {
    return [];
  }

  const rawList = Array.isArray(ignoreGlobalFolder)
    ? ignoreGlobalFolder
    : ignoreGlobalFolder.split(/\r?\n/);

  return rawList
    .map((item) => toPosixPath(item).trim())
    .filter((item) => item.length > 0 && !item.startsWith('#'))
    .filter(onlyUniqueArray);
}

/**
 * WindowsパスをPOSIX形式に変換します
 */
export function toPosixPath(path: string): string {
  return path.replace(/\\/g, '/');
}

// パターンの解析は保存のたびに変わるものではないため、直前の1件だけ使い回す
let cachedMatcher: { key: string; matcher: Ignore } | undefined;

function getIgnoreMatcher(patterns: string[]): Ignore {
  const key = patterns.join('\n');
  if (cachedMatcher?.key !== key) {
    cachedMatcher = { key, matcher: ignore({ allowRelativePaths: true }).add(patterns) };
  }
  return cachedMatcher.matcher;
}

/**
 * ignoreパッケージによるgitignore風の除外判定を行います
 */
export function isPathIgnored(path: string, patterns: string[]): boolean {
  if (!patterns.length) {
    return false;
  }

  const matcher = getIgnoreMatcher(patterns);

  const normalizedPath = toPosixPath(path).replace(/^\/+/, '');
  return matcher.ignores(normalizedPath);
}

/**
 * フォルダ一覧から、除外対象のフォルダだけを抽出します
 */
export function filterIgnoredFolders(
  folders: string[],
  patterns: string | string[] | undefined,
): string[] {
  const normalizedPatterns = normalizeIgnoreFolders(patterns);
  if (!normalizedPatterns.length) {
    return [];
  }

  const matcher = getIgnoreMatcher(normalizedPatterns);

  const normalized = folders.map((folder) => toPosixPath(folder).replace(/\/+$/, ''));
  
  return normalized.filter((folder) => {
    const matchPath = folder ? `${folder}/` : '';
    const normalizedPath = matchPath.replace(/^\/+/, '');
    return matcher.ignores(normalizedPath);
  });
}

/**
 * パス一覧を共通プレフィックスでグループ化します
 */
export function groupByCommonPrefix(entries: string[]): Map<string, string[]> {
  if (entries.length === 0) {
    return new Map();
  }

  const sorted = [...entries].sort();
  const prefixGroup = new Map<string, string[]>();
  let i = 0;

  while (i < sorted.length) {
    const batch = findCommonPrefixBatch(sorted, i);

    if (batch.length > 1) {
      const prefix = commonPathPrefix(batch);
      const relativeItems = batch.map((item) => stripPrefix(item, prefix));
      prefixGroup.set(prefix, relativeItems);
      i += batch.length;
    } else {
      // No common prefix found, collect all remaining items without prefix
      const noPrefix = [];
      while (i < sorted.length) {
        noPrefix.push(sorted[i]);
        i++;
      }
      if (noPrefix.length > 0) {
        prefixGroup.set('', noPrefix);
      }
    }
  }

  return prefixGroup;
}

function findCommonPrefixBatch(sorted: string[], startIndex: number): string[] {
  const current = sorted[startIndex];
  const batch: string[] = [current];
  let j = startIndex + 1;

  while (j < sorted.length) {
    const candidate = sorted[j];
    const common = commonPathPrefix([current, candidate]);

    if (common && common !== current && common !== candidate) {
      batch.push(candidate);
      j++;
    } else {
      break;
    }
  }

  return batch;
}

function stripPrefix(fullPath: string, prefix: string): string {
  if (!prefix || !fullPath.startsWith(prefix)) {
    return fullPath;
  }
  const relative = fullPath.slice(prefix.length).replace(/^\/+/, '');
  return relative || fullPath;
}
