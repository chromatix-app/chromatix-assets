import { describe, expect, it } from 'vitest';

import { splitMultiTag } from './splitMultiTag.ts';

const options = {
  separators: [',', '|', '/', '+', '_', ':', ';'],
  connectors: ['&', 'and', 'y', 'et', 'und', 'e'],
  protectedTags: ['drum & bass', 'drum and bass', 'rhythm & blues', 'rock & roll', 'rock and roll'],
  distributiveHeads: ['metal', 'rock', 'punk', 'house', 'blues', 'jazz', 'techno', 'trance', 'hardcore'],
};

describe('splitMultiTag', () => {
  it('leaves single tags unchanged', () => {
    expect(splitMultiTag('Acid Jazz', options)).toEqual(['Acid Jazz']);
    expect(splitMultiTag('R&B', options)).toEqual(['R&B']);
    expect(splitMultiTag('Rock en Español', options)).toEqual(['Rock en Español']);
  });

  it('splits on separators wherever they appear', () => {
    expect(splitMultiTag('Alternative Rock, Indie Rock', options)).toEqual(['Alternative Rock', 'Indie Rock']);
    expect(splitMultiTag('Thrash Metal | Nu-Metal', options)).toEqual(['Thrash Metal', 'Nu-Metal']);
    expect(splitMultiTag('Jazz+Funk', options)).toEqual(['Jazz', 'Funk']);
    expect(splitMultiTag('Ballad_Pop_Rnb', options)).toEqual(['Ballad', 'Pop', 'Rnb']);
    expect(splitMultiTag(':SuperPop:PowerPop', options)).toEqual(['SuperPop', 'PowerPop']);
  });

  it('splits on connectors only when surrounded by whitespace', () => {
    expect(splitMultiTag('Ambient & New Age & Cosmic', options)).toEqual(['Ambient', 'New Age', 'Cosmic']);
    expect(splitMultiTag('Country and Folk', options)).toEqual(['Country', 'Folk']);
    expect(splitMultiTag('D&B', options)).toEqual(['D&B']);
  });

  it('treats foreign-language connectors as joins', () => {
    expect(splitMultiTag('Rock y Alternativo', options)).toEqual(['Rock', 'Alternativo']);
    expect(splitMultiTag('Alternatif et Indé', options)).toEqual(['Alternatif', 'Indé']);
    expect(splitMultiTag('Alternativ und Indie', options)).toEqual(['Alternativ', 'Indie']);
    expect(splitMultiTag('Hip-hop e Rap', options)).toEqual(['Hip-hop', 'Rap']);
  });

  it('keeps protected phrases whole, even inside a longer list', () => {
    expect(splitMultiTag('Drum & Bass', options)).toEqual(['Drum & Bass']);
    expect(splitMultiTag('Drum & Bass & UK Garage & Jungle', options)).toEqual(['Drum & Bass', 'UK Garage', 'Jungle']);
    expect(splitMultiTag('Rock & Roll, Rhythm & Blues', options)).toEqual(['Rock & Roll', 'Rhythm & Blues']);
    expect(splitMultiTag('drum and bass, jungle', options)).toEqual(['drum and bass', 'jungle']);
  });

  it('handles irregular spacing and drops empty parts', () => {
    expect(splitMultiTag('Ambient  &  Experimental  &  Electronic', options)).toEqual([
      'Ambient',
      'Experimental',
      'Electronic',
    ]);
    expect(splitMultiTag('Dream Pop, Shoegaze,', options)).toEqual(['Dream Pop', 'Shoegaze']);
  });

  it('distributes a trailing head word onto earlier single-word parts', () => {
    expect(splitMultiTag('Death & Black Metal', options)).toEqual(['Death Metal', 'Black Metal']);
    expect(splitMultiTag('Heavy & Power & Speed Metal', options)).toEqual([
      'Heavy Metal',
      'Power Metal',
      'Speed Metal',
    ]);
    expect(splitMultiTag('Indie & Experimental Rock', options)).toEqual(['Indie Rock', 'Experimental Rock']);
  });

  it('does not distribute a head word that is not configured', () => {
    expect(splitMultiTag('Ambient & New Age', options)).toEqual(['Ambient', 'New Age']);
  });

  it('does not distribute when the last part is a single word', () => {
    expect(splitMultiTag('Rock & Pop', options)).toEqual(['Rock', 'Pop']);
    expect(splitMultiTag('Garage Rock & Punk', options)).toEqual(['Garage Rock', 'Punk']);
  });

  it('does not distribute when an earlier part is multi-word', () => {
    expect(splitMultiTag('Blue-Eyed Soul & Jazz Fusion & Alternative Rock', options)).toEqual([
      'Blue-Eyed Soul',
      'Jazz Fusion',
      'Alternative Rock',
    ]);
  });

  it('does not distribute across a protected phrase', () => {
    expect(splitMultiTag('Drum & Bass & Hip Hop', options)).toEqual(['Drum & Bass', 'Hip Hop']);
  });
});
