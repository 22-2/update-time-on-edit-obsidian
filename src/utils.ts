import { parse, format, add, isAfter } from 'date-fns';
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
export function formatDate(input: Date, dateFormat: string, enableNumberProperties: boolean): string | number {
  const output = format(input, dateFormat);
  if (/^\d+$/.test(output) && enableNumberProperties) {
    return parseInt(output);
  }
  return output;
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
  if (typeof ignoreGlobalFolder === 'string') {
    return [ignoreGlobalFolder];
  }
  return ignoreGlobalFolder ?? [];
}
