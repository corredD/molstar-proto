/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * Developed in collaboration with Anyfold <https://anyfold.ai/>
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fitRail, type RailEntry, RailSteps, railStep } from '../rail.js';

function entry(id: string, section: string, priority: number, captioned = false): RailEntry {
  return { id, section, priority, captioned, kind: 'tool' };
}

// The standard rail: 12 buttons and the captioned command menu in 6 sections.
const standard = [
  entry('home', 'head', 0),
  ...['a', 'b', 'c', 'd'].map((id, i) => entry(id, 'strip', 1 + i)),
  entry('anim', 'scene', 5),
  entry('canvas', 'scene', 6),
  entry('export', 'export', 7),
  entry('log', 'foot', 8),
  entry('help', 'foot', 9),
  entry('settings', 'foot', 10),
  entry('theme', 'lead', 100),
  entry('palette', 'lead', -1, true),
];

describe('rail steps', () => {
  it('picks the step by height', () => {
    expect(railStep(900).name).toBe('normal');
    expect(railStep(620).name).toBe('normal');
    expect(railStep(619).name).toBe('compact');
    expect(railStep(530).name).toBe('compact');
    expect(railStep(529).name).toBe('small');
    expect(railStep(100).name).toBe('small');
  });

  it("matches the CSS container queries' thresholds and sizes", () => {
    const css = readFileSync(new URL('../dock.module.css', import.meta.url), 'utf8');
    const queries = [...css.matchAll(/@container \(max-height: (\d+)px\) \{([^}]*\{[^}]*\})/g)];
    const stepped = RailSteps.slice(1); // the first is the default of each var()
    expect(queries.length).toBe(stepped.length);
    stepped.forEach((step, i) => {
      expect(Number(queries[i][1]) + 1).toBe(RailSteps[i].min);
      // The step's size times the UI scale (styling.md §7), as `fitRail` counts it.
      expect(queries[i][2]).toContain(`--msp-rail-button: calc(${step.button}px * var(--msp-ui-scale, 1))`);
      expect(queries[i][2]).toContain(
        `--msp-rail-button-captioned: calc(${step.captioned}px * var(--msp-ui-scale, 1))`,
      );
    });
    const tools = readFileSync(new URL('../canvas.module.css', import.meta.url), 'utf8');
    expect(tools).toContain(`var(--msp-rail-button, calc(${RailSteps[0].button}px * var(--msp-ui-scale, 1)))`);
    expect(tools).toContain(
      `var(--msp-rail-button-captioned, calc(${RailSteps[0].captioned}px * var(--msp-ui-scale, 1)))`,
    );
  });
});

describe('fitRail', () => {
  it('hides nothing while it all fits, or before the height is known', () => {
    expect(fitRail(standard, 900).hidden.size).toBe(0);
    expect(fitRail(standard, 0).hidden.size).toBe(0);
    // 12 * 34 + 40 + 5 hairlines = 453
    expect(fitRail(standard, 460).hidden.size).toBe(0);
    expect(fitRail(standard, 460).step.name).toBe('small');
  });

  it('leaves out the highest priority numbers first, the later of equals, and keeps More in the height', () => {
    // small: 30 / 36; all = 12 * 30 + 36 + 5 = 401
    const fit = fitRail(standard, 360);
    expect([...fit.hidden]).toEqual(['theme', 'settings', 'help']);
    // Rail order breaks ties.
    const tie = [entry('x', 's', 1), entry('y', 's', 1), entry('z', 's', 1)];
    expect([...fitRail(tie, 80).hidden]).toEqual(['z', 'y']);
  });

  it('keeps the most important buttons however short the rail is', () => {
    const fit = fitRail(standard, 100);
    expect(fit.hidden.has('palette')).toBe(false);
    expect(fit.hidden.has('home')).toBe(false);
    // 100px: the command menu (36), More (30) and a hairline, and one more button (30) do not fit with the second.
    expect(fit.hidden.size).toBe(standard.length - 1 - 1);
  });

  it('counts the buttons at the UI scale: the step by the height (as the container queries), the sizes scaled', () => {
    // 900px picks the normal step; at 150 % its buttons are 60 / 69: 12 * 60 + 69 + 5 = 794 fits, at 200 % it does not.
    const big = fitRail(standard, 900, 1.5);
    expect(big.step.name).toBe('normal');
    expect(big.hidden.size).toBe(0);
    expect(fitRail(standard, 900, 2).hidden.size).toBeGreaterThan(0);
    // 460px fits all at 100 % (above), not at 150 %.
    expect(fitRail(standard, 460, 1.5).hidden.size).toBeGreaterThan(0);
  });

  it('is deterministic for a height', () => {
    expect([...fitRail(standard, 300).hidden]).toEqual([...fitRail(standard, 300).hidden]);
  });
});
