import type { UpdateTimeOnEditSettings } from './Settings';

// 旧版が data.json に保存していた項目。
// ハッシュは今はメモリにだけ持ち、照合は常に有効なので、読み込み時に捨てる
const LEGACY_KEYS = ['fileHashMap', 'enableExperimentalHash'] as const;

export type LoadedData = Partial<UpdateTimeOnEditSettings> & Partial<Record<(typeof LEGACY_KEYS)[number], unknown>>;

/**
 * 読み込んだ data.json に既定値を重ね、旧版の項目を取り除く。
 * 取り除いた時は、data.json からも消すため needsSave が true になる。
 */
export function migrateLoadedData(
  loaded: LoadedData | null,
  defaults: UpdateTimeOnEditSettings,
): { settings: UpdateTimeOnEditSettings; needsSave: boolean } {
  const settings: LoadedData = { ...defaults, ...loaded };
  const legacyKeys = LEGACY_KEYS.filter((key) => key in settings);
  for (const key of legacyKeys) {
    delete settings[key];
  }
  return { settings: settings as UpdateTimeOnEditSettings, needsSave: legacyKeys.length > 0 };
}
