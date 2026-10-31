/** @vitest-environment jsdom */
/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * Developed in collaboration with Anyfold <https://anyfold.ai/>
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '../../../dom/render.js';
import { flushFrame } from '../../../reactive/frame-state.js';
import { observableState } from '../../../reactive/observable-state.js';
import { VirtualList } from '../virtual-list.js';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

interface Item {
  readonly id: number;
  readonly label: string;
}

describe('VirtualList', () => {
  it('keys its rows by itemKey (two items of one key are one row)', () => {
    // The JSX runtime keeps `key` for itself, so a `key` prop never arrived and rows were keyed by the item itself.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const items = observableState<readonly Item[]>([
      { id: 1, label: 'a' },
      { id: 1, label: 'b' },
    ]);
    const container = document.createElement('div');
    document.body.append(container);
    const dispose = render(
      () => (
        <VirtualList items={items.asReadonly} itemKey={(r) => r.id} rowHeight={26}>
          {(r) => <div class="row">{r.label}</div>}
        </VirtualList>
      ),
      container,
    );
    expect(container.querySelectorAll('.row').length).toBe(1);
    dispose();
  });

  it('measures its rows from the rows made, not the rows planned', () => {
    // 200 rows planned (a screenful of 800 px at 26 px is 31 rows, plus overscan), but `For` has made only a few: the
    // window's height over the planned count would be far too small a row.
    const observers: { cb: (entries: any[]) => void; target?: Element }[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        cb: (entries: any[]) => void;
        constructor(cb: (entries: any[]) => void) {
          this.cb = cb;
          observers.push({ cb });
        }
        observe(target: Element) {
          observers[observers.length - 1] = { cb: this.cb, target };
          observers.find((o) => o.cb === this.cb)!.target = target;
        }
        unobserve() {}
        disconnect() {}
      },
    );
    const items = observableState<readonly Item[]>(Array.from({ length: 500 }, (_, i) => ({ id: i, label: `r${i}` })));
    const container = document.createElement('div');
    document.body.append(container);
    const dispose = render(
      () => (
        <VirtualList items={items.asReadonly} itemKey={(r) => r.id} rowHeight={26}>
          {(r) => <div class="row">{r.label}</div>}
        </VirtualList>
      ),
      container,
    );
    const win = container.querySelector('[class*="window"]') as HTMLElement;
    const rows = win.childElementCount;
    expect(rows).toBeGreaterThan(0);
    // Remove all but 3 rows (as if the slice ran out), then the observer reports 3 rows of 26 px.
    while (win.childElementCount > 3) win.lastElementChild!.remove();
    for (const o of observers) if (o.target === win) o.cb([{ contentRect: { height: 3 * 30 } }]);
    const content = container.querySelector('[class*="content"]') as HTMLElement;
    expect(content.style.height).toBe(`${500 * 30}px`);
    dispose();
    vi.unstubAllGlobals();
  });

  // The UI scale (styling.md §6): rows a fraction of a pixel off the first guess (a row of 26px at 101.5 %, a row not
  // on `--msp-list-row`) are placed by their measured height, or row 1000 lands rows away from where it is drawn.
  it('places row 1000 by the measured height, however close it is to the guess', async () => {
    const observers: { cb: (entries: any[]) => void; target?: Element }[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(readonly cb: (entries: any[]) => void) {}
        observe(target: Element) {
          observers.push({ cb: this.cb, target });
        }
        unobserve() {}
        disconnect() {}
      },
    );
    const rh = 26.4;
    const items = observableState<readonly Item[]>(Array.from({ length: 2000 }, (_, i) => ({ id: i, label: `r${i}` })));
    const container = document.createElement('div');
    document.body.append(container);
    const dispose = render(
      () => (
        <VirtualList items={items.asReadonly} itemKey={(r) => r.id} rowHeight={26}>
          {(r) => <div class="row">{r.label}</div>}
        </VirtualList>
      ),
      container,
    );
    const win = container.querySelector('[class*="window"]') as HTMLElement;
    for (const o of observers) if (o.target === win) o.cb([{ contentRect: { height: win.childElementCount * rh } }]);
    const content = container.querySelector('[class*="content"]') as HTMLElement;
    expect(content.style.height).toBe(`${2000 * rh}px`);
    // Scrolled to row 1000: the window starts at a row, at that row's measured place.
    const viewport = content.parentElement as HTMLElement;
    Object.defineProperty(viewport, 'clientHeight', { value: 300, configurable: true });
    viewport.scrollTop = 1000 * rh;
    viewport.dispatchEvent(new Event('scroll'));
    await new Promise((r) => setTimeout(r, 200));
    flushFrame();
    const y = Number(/translateY\(([\d.]+)px\)/.exec(win.style.transform)?.[1]);
    const first = Math.round(y / rh);
    expect(first).toBeGreaterThan(900);
    expect(first).toBeLessThanOrEqual(1000);
    expect(y).toBeCloseTo(first * rh, 6);
    dispose();
    vi.unstubAllGlobals();
  });
});
