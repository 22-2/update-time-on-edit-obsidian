import type { TFile, Vault } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { isInvalidFile } from './filter';

function setup(path = 'folder/note.md', overrides: Partial<Record<'name' | 'extension', string>> = {}) {
  const registered = new Map<string, TFile>();
  const vault = { getAbstractFileByPath: (target: string) => registered.get(target) ?? null } as unknown as Vault;
  const file = {
    path,
    name: path.split('/').pop() ?? path,
    extension: 'md',
    vault,
    ...overrides,
  } as unknown as TFile;
  registered.set(path, file);
  return { vault, file, registered };
}

describe('isInvalidFile', () => {
  it('vault に登録された Markdown ファイルは対象にする', () => {
    const { vault, file } = setup();
    expect(isInvalidFile(vault, file)).toBe(false);
  });

  it('Markdown 以外は対象にしない', () => {
    const { vault, file } = setup('folder/image.png', { extension: 'png' });
    expect(isInvalidFile(vault, file)).toBe(true);
  });

  it.each([
    'file:V:/outside/note.md',
    'V:/outside/note.md',
    '/outside/note.md',
    '\\\\server\\share\\note.md',
    '../outside/note.md',
    'folder/../../outside/note.md',
  ])('vault の外のパスは対象にしない: %s', (path) => {
    const { vault, file } = setup(path);
    expect(isInvalidFile(vault, file)).toBe(true);
  });

  it('別の vault のファイルは対象にしない', () => {
    const { file } = setup();
    const otherVault = { getAbstractFileByPath: () => file } as unknown as Vault;
    expect(isInvalidFile(otherVault, file)).toBe(true);
  });

  it('vault から消えた（登録されていない）ファイルは対象にしない', () => {
    const { vault, file, registered } = setup();
    registered.clear();
    expect(isInvalidFile(vault, file)).toBe(true);
  });

  it('Canvas.md と Untitled で始まる一時ファイルは対象にしない', () => {
    const canvas = setup('Canvas.md');
    expect(isInvalidFile(canvas.vault, canvas.file)).toBe(true);
    const untitled = setup('folder/Untitled 1.md');
    expect(isInvalidFile(untitled.vault, untitled.file)).toBe(true);
  });
});
