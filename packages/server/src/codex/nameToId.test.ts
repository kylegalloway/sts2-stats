import { describe, it, expect } from 'vitest';
import { nameToId } from './nameToId.js';

describe('nameToId', () => {
  it('lowercases single-word names', () => {
    expect(nameToId('Strike', 'card')).toBe('strike');
  });

  it('replaces spaces with underscores', () => {
    expect(nameToId('Double Tap', 'card')).toBe('double_tap');
  });

  it('handles multi-word names', () => {
    expect(nameToId('Power Through', 'card')).toBe('power_through');
    expect(nameToId('Burning Blood', 'relic')).toBe('burning_blood');
  });

  it('works for all entity types', () => {
    expect(nameToId('Jaw Worm', 'monster')).toBe('jaw_worm');
    expect(nameToId('Dead Adventurer', 'event')).toBe('dead_adventurer');
  });

  it('handles empty string', () => {
    expect(nameToId('', 'card')).toBe('');
  });

  it('handles already-lowercase input', () => {
    expect(nameToId('strike', 'card')).toBe('strike');
  });
});
