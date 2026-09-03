import { describe, expect, it } from 'vitest';

import { selectPrimaryTag } from './selectPrimaryTag.ts';

const modifiers = ['adult', 'general', 'classic'];

describe('selectPrimaryTag', () => {
  it('picks the first part by default', () => {
    expect(selectPrimaryTag(['Ambient', 'Experimental', 'Electronic'], modifiers)).toBe('Ambient');
    expect(selectPrimaryTag(['Rock', 'Pop'], modifiers)).toBe('Rock');
  });

  it('skips a part that starts with a modifier word in favour of the next part', () => {
    expect(selectPrimaryTag(['Adult Alternative Pop', 'Rock'], modifiers)).toBe('Rock');
    expect(selectPrimaryTag(['Classic Pop', 'Rock'], modifiers)).toBe('Rock');
  });

  it('falls back to the first part if every part starts with a modifier', () => {
    expect(selectPrimaryTag(['Adult Alternative', 'General Pop'], modifiers)).toBe('Adult Alternative');
  });

  it('only looks at the leading word', () => {
    expect(selectPrimaryTag(['Alternative Adult Pop', 'Rock'], modifiers)).toBe('Alternative Adult Pop');
  });

  it('matches modifiers case-insensitively', () => {
    expect(selectPrimaryTag(['ADULT Alternative Pop', 'Rock'], modifiers)).toBe('Rock');
  });

  it('with no modifiers configured, always picks the first part', () => {
    expect(selectPrimaryTag(['Adult Alternative Pop', 'Rock'], [])).toBe('Adult Alternative Pop');
  });
});
