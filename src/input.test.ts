import type { Plugin } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserInputTracker } from './input';

interface Listener {
  target: unknown;
  type: string;
  handler: () => void;
}

function setup(shouldRecord: (doc: Document) => boolean = () => true) {
  const mainDocument = {} as Document;
  vi.stubGlobal('document', mainDocument);

  const listeners: Listener[] = [];
  let onWindowOpen: ((workspaceWindow: unknown, win: { document: Document }) => void) | undefined;
  const plugin = {
    app: {
      workspace: {
        on: vi.fn((_name: string, callback: typeof onWindowOpen) => {
          onWindowOpen = callback;
        }),
      },
    },
    registerEvent: vi.fn(),
    registerDomEvent: vi.fn((target: unknown, type: string, handler: () => void) => {
      listeners.push({ target, type, handler });
    }),
  } as unknown as Plugin;

  const tracker = new UserInputTracker({ windowMs: 10_000, idleMs: 1_500, shouldRecord });
  tracker.start(plugin);

  const press = (target: unknown, type = 'keydown') => {
    listeners.find((listener) => listener.target === target && listener.type === type)?.handler();
  };
  return { tracker, mainDocument, listeners, press, openWindow: (win: { document: Document }) => onWindowOpen?.({}, win) };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('UserInputTracker', () => {
  it('入力が無い間は、入力があったとも入力中とも見なさない', () => {
    const { tracker } = setup();
    expect(tracker.hasRecentInput()).toBe(false);
    expect(tracker.isTyping()).toBe(false);
  });

  it('keydown と beforeinput のどちらでも記録する', () => {
    const { tracker, mainDocument, press } = setup();
    press(mainDocument, 'keydown');
    expect(tracker.hasRecentInput()).toBe(true);

    vi.advanceTimersByTime(11_000);
    expect(tracker.hasRecentInput()).toBe(false);

    press(mainDocument, 'beforeinput');
    expect(tracker.hasRecentInput()).toBe(true);
  });

  it('入力中の判定は短い待機で切れ、入力があった判定は長く続く', () => {
    const { tracker, mainDocument, press } = setup();
    press(mainDocument);
    expect(tracker.isTyping()).toBe(true);

    vi.advanceTimersByTime(2_000);
    expect(tracker.isTyping()).toBe(false);
    expect(tracker.hasRecentInput()).toBe(true);
  });

  it('記録してよい document でなければ記録しない', () => {
    const { tracker, mainDocument, press } = setup(() => false);
    press(mainDocument);
    expect(tracker.hasRecentInput()).toBe(false);
  });

  it('ポップアウトの document も追跡する', () => {
    const { tracker, press, openWindow } = setup();
    const popupDocument = {} as Document;
    openWindow({ document: popupDocument });
    press(popupDocument);
    expect(tracker.hasRecentInput()).toBe(true);
  });

  it('記録するかの判定には、イベントが起きた document を渡す', () => {
    const shouldRecord = vi.fn(() => true);
    const { mainDocument, press } = setup(shouldRecord);
    press(mainDocument);
    expect(shouldRecord).toHaveBeenCalledWith(mainDocument);
  });
});
