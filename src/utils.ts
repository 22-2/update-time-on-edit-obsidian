import { parse, format, add, isAfter } from 'date-fns';
import ignore from 'ignore';
import commonPathPrefix from 'common-path-prefix';
import { sha256 } from 'js-sha256';
import { App, TAbstractFile, TFile } from 'obsidian';

declare global {
  var __DEV_MODE__: boolean;
}
export function onlyUniqueArray<T>(value: T, index: number, self: T[]) {
  return self.indexOf(value) === index;
}

export function isTFile(value: TAbstractFile): value is TFile {
  return 'stat' in value;
}
// ユーティリティ関数群
/**
 * 現在のファイルを取得します
 */
export function getActiveFile(app: App): TFile | null {
  return app.workspace.getActiveFile();
}
/**
 * entryがファイルであるかを判定します
 */
export function isFile(entry: TAbstractFile): entry is TFile {
  return 'stat' in entry;
}
/**
 * 文字列をハッシュ化します
 */
export function hashString(str: string): string {
  return sha256(str);
}
/**
 * 日付をパースします
 */
export function parseDate(input: number | string, dateFormat: string): Date | undefined {
  if (typeof input === 'string') {
    try {
      const parsedDate = parse(input, dateFormat, new Date());

      if (isNaN(parsedDate.getTime())) {
        return undefined;
      }

      return parsedDate;
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
  return format(input, dateFormat);
}
/**
 * 更新すべきかどうかを判定します
 */
export function shouldUpdateValue(
  currentMtime: Date,
  updateHeader: Date,
  minMinutesBetweenSaves: number): boolean {
  const nextUpdate = add(updateHeader, {
    minutes: minMinutesBetweenSaves,
  });
  return isAfter(currentMtime, nextUpdate);
}
/**
 * Excalidrawファイルかどうかを判定します
 */
export function isExcalidrawFile(file: TFile): boolean {
  const ea: any =
    //@ts-expect-error this is comming from global context, injected by Excalidraw
    typeof ExcalidrawAutomate === 'undefined'
      ? undefined
      : //@ts-expect-error this is comming from global context, injected by Excalidraw
      ExcalidrawAutomate; //ea will be undefined if the Excalidraw plugin is not running
  return ea ? ea.isExcalidrawFile(file) : false;
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

/**
 * ignoreパッケージによるgitignore風の除外判定を行います
 */
export function isPathIgnored(path: string, patterns: string[]): boolean {
  if (!patterns.length) {
    return false;
  }

  const matcher = ignore({ allowRelativePaths: true });
  matcher.add(patterns);

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

  const matcher = ignore({ allowRelativePaths: true });
  matcher.add(normalizedPatterns);

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
