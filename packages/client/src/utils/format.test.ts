import { describe, it, expect } from 'vitest';
import { formatName, formatEnemy } from './format';

describe('formatName', () => {
  it('returns em dash for null', () => {
    expect(formatName(null)).toBe('—');
  });

  it('returns em dash for empty string', () => {
    expect(formatName('')).toBe('—');
  });

  it('converts underscores to spaces and title-cases', () => {
    expect(formatName('slime_boss')).toBe('Slime Boss');
  });

  it('uppercases known abbreviations', () => {
    expect(formatName('player_hp')).toBe('Player HP');
    expect(formatName('card_id')).toBe('Card ID');
  });
});

describe('formatEnemy', () => {
  it('returns em dash for null', () => {
    expect(formatEnemy(null)).toBe('—');
  });

  it('returns em dash for NONE.NONE', () => {
    expect(formatEnemy('NONE.NONE')).toBe('—');
  });

  it('strips room type suffix', () => {
    expect(formatEnemy('Slime Boss ELITE')).toBe('Slime Boss');
    expect(formatEnemy('Gremlin Gang NORMAL')).toBe('Gremlin Gang');
  });
});
