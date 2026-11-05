/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { EmpiarUrlParameters, empiarOpenOf } from '../url.js';

// EMPIAR by id in the explorer's URL (extensions/cryoet/_spec/empiar.md §5): the card opened on the entry, nothing loaded.

describe('the EMPIAR URL', () => {
  it('opens the card on an entry, a run picked when named', () => {
    expect(empiarOpenOf('?empiar=12534')).toEqual({ id: 12534 });
    expect(empiarOpenOf('?empiar=EMPIAR-12534&empiar-run=YTC041_1_lam1_1_ts_003')).toEqual({
      id: 12534,
      run: 'YTC041_1_lam1_1_ts_003',
    });
    expect(EmpiarUrlParameters).toEqual(['empiar', 'empiar-run']);
  });

  it('asks for nothing without an id, or with one that is not', () => {
    expect(empiarOpenOf('?empiar-run=YTC041_1_lam1_1_ts_003')).toBeUndefined();
    expect(empiarOpenOf('?empiar=ribosomes')).toBeUndefined();
  });
});
