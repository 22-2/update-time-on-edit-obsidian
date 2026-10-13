import { describe, expect, it, vi } from 'vitest';
import { BaselineStore } from './baseline';

function setup(initial: Record<string, string | null> = {}) {
  const contents = new Map(Object.entries(initial));
  const readContent = vi.fn(async (file: { path: string }) => contents.get(file.path) ?? null);
  const store = new BaselineStore(readContent);
  return { store, contents, readContent };
}

const file = (path: string) => ({ path });

describe('BaselineStore', () => {
  it('記録が無いうちは「変更なし」と判定しない', () => {
    const { store } = setup();
    expect(store.isUnchanged(file('a.md'), 'body')).toBe(false);
  });

  it('記録した本文と同じなら変更なし、違えば変更あり', async () => {
    const { store } = setup({ 'a.md': 'body' });
    await store.record(file('a.md'));
    expect(store.isUnchanged(file('a.md'), 'body')).toBe(true);
    expect(store.isUnchanged(file('a.md'), 'edited')).toBe(false);
  });

  it('フロントマターだけの違いは変更と見なさない', async () => {
    const { store } = setup({ 'a.md': '---\nupdated: 1\n---\nbody' });
    await store.record(file('a.md'));
    expect(store.isUnchanged(file('a.md'), '---\nupdated: 2\ntags: x\n---\nbody')).toBe(true);
  });

  it('本文が空なら記録しない', async () => {
    const { store } = setup({ 'a.md': null });
    await store.record(file('a.md'));
    expect(store.isUnchanged(file('a.md'), '')).toBe(false);
  });

  describe('ensure', () => {
    it('基準が無ければ記録し、あれば読み直さない', async () => {
      const { store, contents, readContent } = setup({ 'a.md': 'body' });
      await store.ensure(file('a.md'));
      contents.set('a.md', 'edited');
      await store.ensure(file('a.md'));
      expect(readContent).toHaveBeenCalledOnce();
      expect(store.isUnchanged(file('a.md'), 'body')).toBe(true);
    });
  });

  describe('refreshIfTracked', () => {
    it('基準があるファイルだけ今の本文に合わせ直す', async () => {
      const { store, contents } = setup({ 'a.md': 'body', 'b.md': 'body' });
      await store.record(file('a.md'));
      contents.set('a.md', 'synced');
      contents.set('b.md', 'synced');

      await store.refreshIfTracked(file('a.md'));
      await store.refreshIfTracked(file('b.md'));

      expect(store.isUnchanged(file('a.md'), 'synced')).toBe(true);
      expect(store.isUnchanged(file('b.md'), 'synced')).toBe(false);
    });
  });

  describe('move / delete', () => {
    it('改名すると基準が引き継がれ、古いパスの基準は消える', async () => {
      const { store } = setup({ 'old.md': 'body' });
      await store.record(file('old.md'));
      store.move('old.md', 'new.md');
      expect(store.isUnchanged(file('new.md'), 'body')).toBe(true);
      expect(store.isUnchanged(file('old.md'), 'body')).toBe(false);
    });

    it('基準が無いパスの改名は何もしない', () => {
      const { store } = setup();
      store.move('old.md', 'new.md');
      expect(store.isUnchanged(file('new.md'), 'body')).toBe(false);
    });

    it('削除すると基準も消える', async () => {
      const { store } = setup({ 'a.md': 'body' });
      await store.record(file('a.md'));
      store.delete('a.md');
      expect(store.isUnchanged(file('a.md'), 'body')).toBe(false);
    });
  });
});
