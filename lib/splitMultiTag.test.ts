import { describe, expect, it } from 'vitest';

import { splitMultiTag } from './splitMultiTag.ts';

describe('splitMultiTag', () => {
  it('leaves single tags unchanged', () => {
    expect(splitMultiTag('Acid Jazz')).toEqual(['Acid Jazz']);
    expect(splitMultiTag('R&B')).toEqual(['R&B']);
    expect(splitMultiTag('Rock en Español')).toEqual(['Rock en Español']);
  });

  it('splits comma-separated tags', () => {
    expect(splitMultiTag('Alternative Rock, Indie Rock')).toEqual(['Alternative Rock', 'Indie Rock']);
    expect(splitMultiTag('Blues, Country, Folk')).toEqual(['Blues', 'Country', 'Folk']);
  });

  it('splits tags joined with " & " (surrounded by whitespace)', () => {
    expect(splitMultiTag('Ambient & New Age & Cosmic')).toEqual(['Ambient', 'New Age', 'Cosmic']);
    expect(splitMultiTag('Dance & House')).toEqual(['Dance', 'House']);
  });

  it('splits tags joined with " and "', () => {
    expect(splitMultiTag('Country and Folk')).toEqual(['Country', 'Folk']);
  });

  it('does not split on a bare "&" with no surrounding whitespace', () => {
    expect(splitMultiTag('R&B')).toEqual(['R&B']);
    expect(splitMultiTag('D&B')).toEqual(['D&B']);
  });

  it('does not split known "X & Y" genre names that are a single tag', () => {
    expect(splitMultiTag('Drum & Bass')).toEqual(['Drum & Bass']);
    expect(splitMultiTag('Rhythm & Blues')).toEqual(['Rhythm & Blues']);
    expect(splitMultiTag('Rock & Roll')).toEqual(['Rock & Roll']);
  });

  it('keeps a known "X & Y" genre name intact even when it appears alongside other delimited tags', () => {
    expect(splitMultiTag('Drum & Bass & UK Garage & Jungle')).toEqual(['Drum & Bass', 'UK Garage', 'Jungle']);
    expect(splitMultiTag('Drum & Bass, Jungle')).toEqual(['Drum & Bass', 'Jungle']);
    expect(splitMultiTag('Rock & Roll, Rhythm & Blues')).toEqual(['Rock & Roll', 'Rhythm & Blues']);
  });

  it('handles mixed delimiters and irregular spacing', () => {
    expect(splitMultiTag('Ambient  &  Experimental  &  Electronic')).toEqual(['Ambient', 'Experimental', 'Electronic']);
    expect(splitMultiTag('Alternative,Pop,Indie Pop & Folk,Rock,Indie Rock & Rock Pop')).toEqual([
      'Alternative',
      'Pop',
      'Indie Pop',
      'Folk',
      'Rock',
      'Indie Rock',
      'Rock Pop',
    ]);
  });

  it('trims whitespace from each split part', () => {
    expect(splitMultiTag('Rock ,  Pop')).toEqual(['Rock', 'Pop']);
  });
});
