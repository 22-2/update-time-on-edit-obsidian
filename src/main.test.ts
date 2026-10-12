import type { App, PluginManifest, TFile } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { domHandlers } from '../test/obsidian';
import UpdateTimeOnEditPlugin from './main';

vi.mock('./Settings', () => ({
  DEFAULT_SETTINGS: {
    dateFormat: 'YYYY-MM-DDTHH:mm',
    enableCreateTime: true,
    headerUpdated: 'updated',
    headerCreated: 'created',
    minMinutesBetweenSaves: 1,
    ignoreGlobalFolder: [],
    enableExperimentalHash: false,
    fileHashMap: {},
    skipFrontmatterWhenCursorInFrontmatter: false,
  },
  UpdateTimeOnEditSettingsTab: class {},
}));

async function setup(path = 'note.md') {
  const doc = { hasFocus: vi.fn(() => true) };
  vi.stubGlobal('document', doc);
  const vault = {
    on: vi.fn(),
    read: vi.fn(async () => 'body'),
    getAbstractFileByPath: vi.fn((path: string): TFile | null =>
      path === file.path ? file : null,
    ),
  };
  const file = {
    path,
    extension: 'md',
    name: 'note.md',
    vault,
    stat: { ctime: Date.now(), mtime: Date.now(), size: 4 },
  } as unknown as TFile;
  const frontmatter: Record<string, unknown> = {};
  const processFrontMatter = vi.fn(
    async (_file: TFile, callback: (data: Record<string, unknown>) => void) => {
      callback(frontmatter);
    },
  );
  const workspace = {
    on: vi.fn(),
    getActiveFile: vi.fn((): TFile | null => file),
    activeLeaf: { view: { containerEl: { ownerDocument: doc } } },
  };
  const plugin = new UpdateTimeOnEditPlugin(
    { vault, workspace, fileManager: { processFrontMatter } } as unknown as App,
    {} as PluginManifest,
  );
  await plugin.onload();
  plugin.settings.fileHashMap = {};

  const input = (target = doc) => {
    const listener = domHandlers.find(
      ({ target: element, type }) => element === target && type === 'beforeinput',
    );
    if (!listener) {
      throw new Error('入力ハンドラーが見つかりません');
    }
    listener.handler();
  };
  const emit = (source: typeof vault | typeof workspace, name: string, ...args: unknown[]) => {
    const callback = source.on.mock.calls.find(([event]) => event === name)?.[1] as ((...args: unknown[]) => void) | undefined;
    if (!callback) {
      throw new Error(`イベントが見つかりません: ${name}`);
    }
    callback(...args);
  };
  return { plugin, file, doc, vault, workspace, processFrontMatter, frontmatter, input, emit };
}

beforeEach(() => {
  vi.useFakeTimers();
  // テスト環境には window が無いため、タイマーだけを持つ window を差し込む（フェイクタイマーに追従させる）
  vi.stubGlobal('window', {
    setTimeout: (callback: () => void, ms?: number) => setTimeout(callback, ms),
    clearTimeout: (id?: ReturnType<typeof setTimeout>) => clearTimeout(id),
  });
  vi.stubGlobal('moment', (value: number) => ({ format: () => new Date(value).toISOString() }));
  domHandlers.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('自動更新の対象とフォーカス', () => {
  it.each([
    'file:V:/outside/note.md',
    'V:/outside/note.md',
    '/outside/note.md',
    '\\\\server\\share\\note.md',
    '../outside/note.md',
  ])('vault に登録された外部ファイルも除外する: %s', async (path) => {
    const s = await setup(path);
    s.input();
    expect(await s.plugin.handleFileChange(s.file)).toEqual({ status: 'ignored' });
    expect(s.vault.read).not.toHaveBeenCalled();
    expect(s.processFrontMatter).not.toHaveBeenCalled();
    s.plugin.settings.enableExperimentalHash = true;
    s.emit(s.workspace, 'file-open', s.file);
    await vi.runAllTimersAsync();
    expect(s.plugin.settings.fileHashMap).toEqual({});
  });

  it('フォーカスのある vault 内の編集は更新する', async () => {
    const s = await setup();
    s.input();
    s.emit(s.vault, 'modify', s.file);
    await vi.advanceTimersByTimeAsync(3000);
    expect(s.frontmatter.updated).toBeDefined();
    expect(s.processFrontMatter).toHaveBeenCalledOnce();
  });

  it('別ウィンドウがフォーカスされていても対象タブが非フォーカスなら更新しない', async () => {
    const s = await setup();
    s.input();
    vi.stubGlobal('activeDocument', { hasFocus: () => true });
    s.doc.hasFocus.mockReturnValue(false);
    s.emit(s.vault, 'modify', s.file);
    await vi.runAllTimersAsync();
    expect(s.processFrontMatter).not.toHaveBeenCalled();
  });

  it('予約後にフォーカスが外れたら更新しない', async () => {
    const s = await setup();
    s.input();
    s.emit(s.vault, 'modify', s.file);
    s.doc.hasFocus.mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(s.processFrontMatter).not.toHaveBeenCalled();
  });

  it('内容の読み取り中にフォーカスが外れたら更新しない', async () => {
    const s = await setup();
    s.input();
    s.vault.read.mockImplementation(async () => {
      s.doc.hasFocus.mockReturnValue(false);
      return 'body';
    });
    expect(await s.plugin.handleFileChange(s.file)).toEqual({ status: 'ignored' });
    expect(s.processFrontMatter).not.toHaveBeenCalled();
  });

  it('プロパティ変更直前にフォーカスが外れたら書き換えない', async () => {
    const s = await setup();
    s.input();
    s.processFrontMatter.mockImplementation(async (_file, callback) => {
      s.doc.hasFocus.mockReturnValue(false);
      callback(s.frontmatter);
    });
    expect(await s.plugin.handleFileChange(s.file)).toEqual({ status: 'ignored' });
    expect(s.frontmatter).toEqual({});
    expect(s.vault.read).toHaveBeenCalledOnce();
  });

  it('非フォーカス時の入力を更新の根拠にしない', async () => {
    const s = await setup();
    s.doc.hasFocus.mockReturnValue(false);
    s.input();
    s.doc.hasFocus.mockReturnValue(true);
    expect(await s.plugin.handleFileChange(s.file)).toEqual({ status: 'ignored' });
    expect(s.processFrontMatter).not.toHaveBeenCalled();
  });

  it('予約後にアクティブファイルが変わったら更新しない', async () => {
    const s = await setup();
    s.input();
    s.emit(s.vault, 'modify', s.file);
    s.workspace.getActiveFile.mockReturnValue(null);
    await vi.advanceTimersByTimeAsync(3000);
    expect(s.processFrontMatter).not.toHaveBeenCalled();
  });

  it('ポップアウトでは対象タブの document を使う', async () => {
    const s = await setup();
    const popupDocument = { hasFocus: vi.fn(() => true) };
    s.doc.hasFocus.mockReturnValue(false);
    s.workspace.activeLeaf.view.containerEl.ownerDocument = popupDocument;
    s.emit(s.workspace, 'window-open', {}, { document: popupDocument });
    s.input(popupDocument);
    expect(await s.plugin.handleFileChange(s.file)).toEqual({ status: 'ok' });
    expect(s.frontmatter.updated).toBeDefined();
  });

  it('アンロード時には予約済みの更新を取り消す', async () => {
    const s = await setup();
    s.input();
    s.emit(s.vault, 'modify', s.file);
    s.plugin.onunload();
    await vi.runAllTimersAsync();
    expect(s.processFrontMatter).not.toHaveBeenCalled();
  });
});
