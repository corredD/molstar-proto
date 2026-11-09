/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { describe, expect, it } from 'vitest';
import { Sections, type Subject } from '../properties.js';

// A lipid membrane's properties against a particle list's (Ludo, 2026-11-08: "lipids membrane should be like particle
// system and have the same properties"): the sections each shows, compared. What differs is what a procedural pool
// cannot hold this round (lipid-procedural's design: no motion, no per-lipid layers; a list's representations and
// targets are its particles'), listed here so a change is seen.

function sections(subject: unknown) {
  return Sections.filter((s) => s.when(subject as Subject)).map((s) => s.id);
}

const api = {
  mesoscale: {
    membraneDetailState: (ref: string) => ({ value: ref === 'membrane' ? { method: 'cutter' } : undefined }),
  },
  describe: () => true,
};

describe('a lipid membrane’s properties, a particle list’s', () => {
  it('shows a particle list’s Look and Object graphics; what it leaves out is listed', () => {
    const membrane = sections({ api, area: {}, picked: { kind: 'mesh', node: { ref: 'membrane' } } });
    const list = sections({ api, area: {}, picked: { kind: 'particle list', node: { ref: 'list' } } });
    expect(membrane).toContain('graphics');
    const shared = list.filter((id) => membrane.includes(id));
    expect(shared).toContain('graphics');
    // a list's own sections a membrane has no use for (its representations, its targets' decoration)
    expect(list.filter((id) => !membrane.includes(id)).sort()).toMatchInlineSnapshot(`
      [
        "decoration",
        "representation",
      ]
    `);
    // a plain mesh: no Object graphics
    expect(sections({ api, area: {}, picked: { kind: 'mesh', node: { ref: 'mesh' } } })).not.toContain('graphics');
  });
});
