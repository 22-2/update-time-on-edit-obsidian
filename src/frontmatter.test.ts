import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTimestamps, type FrontMatter, type TimestampOptions } from './frontmatter';

// Obsidian の moment の代わりに、使う範囲だけ Date で実装する
interface FakeMoment {
  isValid(): boolean;
  toDate(): Date;
  format(): string;
  add(amount: number): FakeMoment;
  isAfter(other: Date): boolean;
}

// 時刻文字列は UTC として読み、実行環境のタイムゾーンに左右されないようにする
function toDate(input: Date | number | string | undefined): Date {
  if (input instanceof Date) return input;
  if (typeof input === 'string') return new Date(input.endsWith('Z') ? input : `${input}Z`);
  return new Date(input ?? Date.now());
}

function fakeMoment(input?: Date | number | string): FakeMoment {
  const date = toDate(input);
  return {
    isValid: () => !Number.isNaN(date.getTime()),
    toDate: () => date,
    format: () => date.toISOString().slice(0, 16),
    add: (minutes) => fakeMoment(new Date(date.getTime() + minutes * 60_000)),
    isAfter: (other) => date.getTime() > other.getTime(),
  };
}

const OPTIONS: TimestampOptions = {
  dateFormat: 'YYYY-MM-DDTHH:mm',
  headerCreated: 'created',
  headerUpdated: 'updated',
  minMinutesBetweenSaves: 1,
  addCreated: true,
};

const CTIME = Date.UTC(2026, 0, 1, 0, 0);
const MTIME = Date.UTC(2026, 0, 1, 0, 30);

beforeEach(() => {
  vi.stubGlobal('moment', fakeMoment);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('applyTimestamps', () => {
  it('値が無ければ created と updated を書く', () => {
    const frontmatter: FrontMatter = {};
    expect(applyTimestamps(frontmatter, { ctime: CTIME, mtime: MTIME }, OPTIONS)).toBe('updated');
    expect(frontmatter).toEqual({ created: '2026-01-01T00:00', updated: '2026-01-01T00:30' });
  });

  it('addCreated が false なら created を書かない', () => {
    const frontmatter: FrontMatter = {};
    applyTimestamps(frontmatter, { ctime: CTIME, mtime: MTIME }, { ...OPTIONS, addCreated: false });
    expect(frontmatter).toEqual({ updated: '2026-01-01T00:30' });
  });

  it('created が既にあれば上書きしない', () => {
    const frontmatter: FrontMatter = { created: '1999-12-31T00:00' };
    applyTimestamps(frontmatter, { ctime: CTIME, mtime: MTIME }, OPTIONS);
    expect(frontmatter.created).toBe('1999-12-31T00:00');
  });

  it('前回の updated から最小間隔を過ぎていれば書き換える', () => {
    const frontmatter: FrontMatter = { updated: '2026-01-01T00:00' };
    expect(applyTimestamps(frontmatter, { ctime: CTIME, mtime: MTIME }, OPTIONS)).toBe('updated');
    expect(frontmatter.updated).toBe('2026-01-01T00:30');
  });

  it('最小間隔の内なら書き換えない', () => {
    const frontmatter: FrontMatter = { updated: '2026-01-01T00:29' };
    expect(applyTimestamps(frontmatter, { ctime: CTIME, mtime: MTIME }, { ...OPTIONS, minMinutesBetweenSaves: 5 })).toBe(
      'up-to-date',
    );
    expect(frontmatter.updated).toBe('2026-01-01T00:29');
  });

  it('updated が日付として読めなければ書き換える', () => {
    const frontmatter: FrontMatter = { updated: 'not a date' };
    expect(applyTimestamps(frontmatter, { ctime: CTIME, mtime: MTIME }, OPTIONS)).toBe('updated');
    expect(frontmatter.updated).toBe('2026-01-01T00:30');
  });

  it('キー名の設定に従う', () => {
    const frontmatter: FrontMatter = {};
    applyTimestamps(
      frontmatter,
      { ctime: CTIME, mtime: MTIME },
      { ...OPTIONS, headerCreated: 'c', headerUpdated: 'u' },
    );
    expect(Object.keys(frontmatter).sort()).toEqual(['c', 'u']);
  });
});
