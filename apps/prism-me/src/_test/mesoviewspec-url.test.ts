/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { MesoViewSpecUrlParameters, mesoViewSpecOf } from '../url.js';

// A MesoViewSpec document by address in the explorer's URL (_spec/prism.md §3).

describe('the MesoViewSpec URL', () => {
  it('names the document to open, trimmed', () => {
    expect(mesoViewSpecOf('?mesoviewspec=https://example.org/d/cell.mesoviewspec.json')).toBe(
      'https://example.org/d/cell.mesoviewspec.json',
    );
    expect(mesoViewSpecOf('?example=petworld-hiv&mesoviewspec=%20https%3A%2F%2Fexample.org%2Fa.mesoviewspec%20')).toBe(
      'https://example.org/a.mesoviewspec',
    );
    expect(MesoViewSpecUrlParameters).toEqual(['mesoviewspec']);
  });

  it('asks for nothing without an address', () => {
    expect(mesoViewSpecOf('')).toBeUndefined();
    expect(mesoViewSpecOf('?mesoviewspec=')).toBeUndefined();
    expect(mesoViewSpecOf('?mesoviewspec=%20')).toBeUndefined();
    expect(mesoViewSpecOf('?example=petworld-hiv')).toBeUndefined();
  });
});
