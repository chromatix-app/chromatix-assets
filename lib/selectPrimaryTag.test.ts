import { describe, expect, it } from 'vitest';

import { selectPrimaryTag } from './selectPrimaryTag.ts';

describe('selectPrimaryTag', () => {
  it('picks the first part by default', () => {
    expect(selectPrimaryTag(['Ambient', 'Experimental', 'Electronic'])).toBe('Ambient');
    expect(selectPrimaryTag(['Rock', 'Pop'])).toBe('Rock');
  });

  it('deprioritizes a part starting with a known qualifier word in favour of the next part', () => {
    expect(selectPrimaryTag(['Adult Alternative Pop', 'Rock'])).toBe('Rock');
    expect(selectPrimaryTag(['Adult Contemporary Rock', 'Pop'])).toBe('Pop');
  });

  it('falls back to the first part if every part starts with a qualifier word', () => {
    expect(selectPrimaryTag(['Adult Alternative', 'Adult Contemporary'])).toBe('Adult Alternative');
  });

  it('does not deprioritize a genre name that merely contains a qualifier word later in the string', () => {
    expect(selectPrimaryTag(['Alternative Adult Pop', 'Rock'])).toBe('Alternative Adult Pop');
  });

  it('matches the qualifier word case-insensitively', () => {
    expect(selectPrimaryTag(['ADULT Alternative Pop', 'Rock'])).toBe('Rock');
  });
});
