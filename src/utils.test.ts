import { describe, expect, it } from 'vitest';
import {
  filterIgnoredFolders,
  groupByCommonPrefix,
  hashBody,
  isPathIgnored,
  stripFrontmatter,
} from './utils';

describe('stripFrontmatter', () => {
  it('先頭のフロントマターを除く', () => {
    expect(stripFrontmatter('---\ntitle: a\n---\nbody')).toBe('body');
    expect(stripFrontmatter('---\r\ntitle: a\r\n---\r\nbody')).toBe('body');
  });

  it('フロントマターが無ければそのまま返す', () => {
    expect(stripFrontmatter('body\n---\nnot fm\n---\n')).toBe(
      'body\n---\nnot fm\n---\n',
    );
  });

  it('閉じ区切りが無ければそのまま返す', () => {
    expect(stripFrontmatter('---\ntitle: a\nbody')).toBe('---\ntitle: a\nbody');
  });
});

describe('hashBody', () => {
  it('フロントマターだけが違っても同じハッシュになる', () => {
    expect(hashBody('---\nupdated: 1\n---\nbody')).toBe(
      hashBody('---\nupdated: 2\ntags: x\n---\nbody'),
    );
  });

  it('本文が違えば別のハッシュになる', () => {
    expect(hashBody('---\na: 1\n---\nbody')).not.toBe(
      hashBody('---\na: 1\n---\nbody2'),
    );
  });
});

describe('isPathIgnored', () => {
  it('パターンが変わったら判定も変わる（判定オブジェクトを使い回しても）', () => {
    expect(isPathIgnored('a/b.md', ['a/'])).toBe(true);
    expect(isPathIgnored('a/b.md', ['a/'])).toBe(true);
    expect(isPathIgnored('a/b.md', ['c/'])).toBe(false);
    expect(isPathIgnored('a/b.md', ['a/*', '!a/b.md'])).toBe(false);
  });
});

describe('filterIgnoredFolders', () => {
  it('excludes parent but re-includes negated child (etc/* + !etc/journals/)', () => {
    const patterns = ['etc/*', '!etc/journals/'];

    const input = [
      'etc/archives',
      'etc/clippings',
      'etc/journals',
      'etc/templates',
    ];

    const result = filterIgnoredFolders(input, patterns);

    // etc/journals should NOT be in the ignored list (re-included by negation)
    expect(result).toEqual([
      'etc/archives',
      'etc/clippings',
      'etc/templates',
    ]);

    // etc/journals should be monitored
    expect(result).not.toContain('etc/journals');
  });

  it('excludes deeply nested folders matching parent ignore', () => {
    const patterns = ['etc/*', '!etc/journals/'];

    const input = [
      'etc/archives',
      'etc/clippings',
      'etc/journals',
      'etc/old-vaults/aozora-v2/etc/journal',
      'etc/old-vaults/aozora-v2/home/000-Projects',
      'etc/templates',
    ];

    const result = filterIgnoredFolders(input, patterns);

    // Deeply nested folders under etc/* should still be ignored
    expect(result).toContain('etc/old-vaults/aozora-v2/etc/journal');
    expect(result).toContain('etc/old-vaults/aozora-v2/home/000-Projects');

    // But etc/journals should be re-included
    expect(result).not.toContain('etc/journals');
  });
});

describe('groupByCommonPrefix', () => {
  it('preserves all entries when no common prefix exists', () => {
    const input = ['home', 'documents', 'projects'];
    const result = groupByCommonPrefix(input);

    // All should be in separate groups with empty prefix (sorted)
    expect(result.get('')).toEqual(['documents', 'home', 'projects']);
  });

  it('groups entries with common prefix', () => {
    const input = ['etc/archives', 'etc/clippings', 'etc/templates', 'home'];
    const result = groupByCommonPrefix(input);

    // Should have 'etc/' as prefix group and 'home' separately
    expect(result.has('etc/')).toBe(true);
    expect(result.get('etc/')).toEqual(['archives', 'clippings', 'templates']);
    expect(result.get('')).toEqual(['home']);
  });

  it('preserves etc/journals even with etc/* prefix', () => {
    const input = ['etc/archives', 'etc/clippings', 'etc/journals', 'home'];
    const result = groupByCommonPrefix(input);

    // All etc/* items should be in the etc/ group
    const etcGroup = result.get('etc/');
    expect(etcGroup).toBeDefined();
    expect(etcGroup).toContain('journals');
    expect(etcGroup).toContain('archives');
    expect(etcGroup).toContain('clippings');

    // home should be separate
    expect(result.get('')).toEqual(['home']);
  });

  it('handles deeply nested paths', () => {
    const input = [
      'etc/old-vaults/aozora-v2/etc/journal',
      'etc/old-vaults/aozora-v2/home/000-Projects',
      'etc/old-vaults/spf/etc/excalidraw',
      'home',
    ];
    const result = groupByCommonPrefix(input);

    // All etc/old-vaults paths should be grouped
    const etcVaultsGroup = result.get('etc/old-vaults/');
    expect(etcVaultsGroup).toBeDefined();
    expect(etcVaultsGroup?.length).toBe(3);

    // home should be separate
    expect(result.get('')).toEqual(['home']);
  });
});
