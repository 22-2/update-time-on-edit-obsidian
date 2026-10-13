import { describe, expect, it } from 'vitest';
import { migrateLoadedData } from './migration';
import type { UpdateTimeOnEditSettings } from './Settings';

const DEFAULTS: UpdateTimeOnEditSettings = {
  dateFormat: 'YYYY-MM-DDTHH:mm',
  enableCreateTime: true,
  headerUpdated: 'updated',
  headerCreated: 'created',
  minMinutesBetweenSaves: 1,
  ignoreGlobalFolder: [],
  skipFrontmatterWhenCursorInFrontmatter: true,
  debugLogging: false,
};

describe('migrateLoadedData', () => {
  it('data.json が無ければ既定値を使い、保存はしない', () => {
    expect(migrateLoadedData(null, DEFAULTS)).toEqual({ settings: DEFAULTS, needsSave: false });
  });

  it('読み込んだ値を既定値に重ねる', () => {
    const { settings, needsSave } = migrateLoadedData({ headerUpdated: 'modified' }, DEFAULTS);
    expect(settings).toEqual({ ...DEFAULTS, headerUpdated: 'modified' });
    expect(needsSave).toBe(false);
  });

  it('旧版の項目は取り除き、保存が必要だと伝える', () => {
    const { settings, needsSave } = migrateLoadedData(
      { headerUpdated: 'modified', fileHashMap: { 'a.md': 'x' }, enableExperimentalHash: false },
      DEFAULTS,
    );
    expect(settings).not.toHaveProperty('fileHashMap');
    expect(settings).not.toHaveProperty('enableExperimentalHash');
    expect(settings.headerUpdated).toBe('modified');
    expect(needsSave).toBe(true);
  });

  it('どちらか一方だけでも取り除く', () => {
    const { settings, needsSave } = migrateLoadedData({ enableExperimentalHash: true }, DEFAULTS);
    expect(settings).not.toHaveProperty('enableExperimentalHash');
    expect(needsSave).toBe(true);
  });

  it('既定値や渡したデータを書き換えない', () => {
    const loaded = { fileHashMap: { 'a.md': 'x' } };
    migrateLoadedData(loaded, DEFAULTS);
    expect(loaded).toEqual({ fileHashMap: { 'a.md': 'x' } });
    expect(DEFAULTS).not.toHaveProperty('fileHashMap');
  });
});
