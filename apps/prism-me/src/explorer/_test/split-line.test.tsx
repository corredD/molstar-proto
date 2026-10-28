/** @vitest-environment jsdom */
/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { render } from '@molstar/prism-ui/dom/render';
import { flushFrame, frameState } from '@molstar/prism-ui/dom/scope';
import { lostReleases, stubPointerCapture } from '@molstar/prism-ui/testing/gestures';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SplitLine } from '../tree-view.js';

// The line between the tree and the properties (tree-view.tsx, ui.md Status 2026-10-27): a `drag()` gesture (Prism's
// rule: attached once, every end path releases), clamped, and ↑/↓ by 16 px (Shift 64). jsdom lays nothing out: the
// panel says it is 640 px tall, so the properties are kept between 80 and 480 px.

beforeAll(stubPointerCapture);
afterEach(() => {
  document.body.innerHTML = '';
});

function mount(initial = 280) {
  const panel = document.createElement('div');
  Object.defineProperty(panel, 'clientHeight', { value: 640 });
  const container = document.createElement('div');
  document.body.append(container);
  let height!: ReturnType<typeof frameState<number>>;
  render(() => {
    height = frameState(initial);
    return <SplitLine height={height} panel={() => panel} />;
  }, container);
  const line = container.querySelector<HTMLElement>('[role=separator]')!;
  return { height, line };
}

const key = (el: HTMLElement, k: string, shiftKey = false) => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true }));
  flushFrame();
};

describe("the split's line", () => {
  it('leaves no listener after lost releases, and the next drag sizes the properties', () => {
    const { height, line } = mount();
    const r = lostReleases({
      target: () => line,
      from: { x: 10, y: 300 },
      to: { x: 10, y: 260 },
      reset: () => {
        height.offer(280);
        flushFrame();
      },
      worked: () => {
        flushFrame();
        // dragged up by 40 px: the properties 40 px taller
        return height.value === 320;
      },
    });
    expect(r.grown).toBe(0);
    expect(r.worked).toBe(true);
  });

  it('keeps the properties between 80 px and what leaves the tree 80 px', () => {
    const { height, line } = mount();
    lostReleases({ target: () => line, from: { x: 0, y: 300 }, to: { x: 0, y: -1000 }, worked: () => true }, 0);
    flushFrame();
    expect(height.value).toBe(480);
    lostReleases({ target: () => line, from: { x: 0, y: 0 }, to: { x: 0, y: 2000 }, worked: () => true }, 0);
    flushFrame();
    expect(height.value).toBe(80);
  });

  it('moves by 16 px with ↑/↓ (64 with Shift), clamped, and says its range', () => {
    const { height, line } = mount();
    key(line, 'ArrowUp');
    expect(height.value).toBe(296);
    key(line, 'ArrowDown', true);
    expect(height.value).toBe(232);
    for (let i = 0; i < 10; i++) key(line, 'ArrowDown', true);
    expect(height.value).toBe(80);
    expect(line.getAttribute('aria-valuemin')).toBe('80');
    expect(line.getAttribute('aria-valuemax')).toBe('480');
  });
});
