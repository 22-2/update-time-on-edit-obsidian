import { describe, expect, it } from 'vitest';
import { filterIgnoredFolders } from '../utils';

describe('filterIgnoredFolders', () => {
  it('does not re-include when parent is ignored (gitignore semantics)', () => {
    const patterns = ['etc/', '!etc/journals/'];

    const input = [
      'etc/archives',
      'etc/clippings',
      'etc/journals',
      'etc/old-vaults/aozora-v2/etc/journal',
      'etc/old-vaults/aozora-v2/home/000-Projects',
      'etc/old-vaults/aozora-v2/home/002-Resources',
      'etc/old-vaults/aozora-v2/home/003-Archives',
      'etc/old-vaults/aozora-v2/home/@inbox',
      'etc/old-vaults/aozora/etc/clippings',
      'etc/old-vaults/aozora/etc/jornal',
      'etc/old-vaults/aozora/home/notes/000-tekito',
      'etc/old-vaults/aozora/home/notes/001-✨gachi',
      'etc/old-vaults/aozora/home/notes/003-templates',
      'etc/old-vaults/aozora/home/notes/100-episodes',
      'etc/old-vaults/aozora/home/notes/200-ai',
      'etc/old-vaults/aozora/home/notes/999-mocs',
      'etc/old-vaults/g-neet/home',
      'etc/old-vaults/new-super-fernand/home',
      'etc/old-vaults/spf/etc/etc/excalidraw',
      'etc/old-vaults/spf/etc/etc/journals',
      'etc/old-vaults/spf/home/home',
      'etc/old-vaults/super-fernand/etc',
      'etc/old-vaults/super-fernand/home',
      'etc/old-vaults/wdiary',
      'etc/templates',
    ];

    const expected = [
      'etc/archives',
      'etc/clippings',
      'etc/journals',
      'etc/old-vaults/aozora-v2/etc/journal',
      'etc/old-vaults/aozora-v2/home/000-Projects',
      'etc/old-vaults/aozora-v2/home/002-Resources',
      'etc/old-vaults/aozora-v2/home/003-Archives',
      'etc/old-vaults/aozora-v2/home/@inbox',
      'etc/old-vaults/aozora/etc/clippings',
      'etc/old-vaults/aozora/etc/jornal',
      'etc/old-vaults/aozora/home/notes/000-tekito',
      'etc/old-vaults/aozora/home/notes/001-✨gachi',
      'etc/old-vaults/aozora/home/notes/003-templates',
      'etc/old-vaults/aozora/home/notes/100-episodes',
      'etc/old-vaults/aozora/home/notes/200-ai',
      'etc/old-vaults/aozora/home/notes/999-mocs',
      'etc/old-vaults/g-neet/home',
      'etc/old-vaults/new-super-fernand/home',
      'etc/old-vaults/spf/etc/etc/excalidraw',
      'etc/old-vaults/spf/etc/etc/journals',
      'etc/old-vaults/spf/home/home',
      'etc/old-vaults/super-fernand/etc',
      'etc/old-vaults/super-fernand/home',
      'etc/old-vaults/wdiary',
      'etc/templates',
    ];

    const result = filterIgnoredFolders(input, patterns);
    expect(result).toEqual(expected);
  });
});
