/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// A text edited where it is (a label's, from its right-click): a field at the pointer, its text selected; Enter keeps
// it, Escape or a click elsewhere leaves it as it was. An interaction of one edit: its listeners go with it.

export function editInline(
  root: HTMLElement,
  at: { x: number; y: number },
  text: string,
  keep: (text: string) => void,
) {
  const rootRect = root.getBoundingClientRect();
  const input = document.createElement('input');
  input.type = 'text';
  input.value = text;
  input.setAttribute('aria-label', "The label's text");
  input.style.cssText = `position: absolute; left: ${at.x - rootRect.left}px; top: ${at.y - rootRect.top}px; z-index: 60; min-width: 200px; padding: 4px 8px; border-radius: 6px; border: 1px solid var(--msp-color-accent, #6aa0ff); background: var(--msp-color-surface, #222); color: var(--msp-color-text, #eee); font: inherit; font-size: 13px; outline: none; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4)`;
  let done = false;
  const finish = (commit: boolean) => {
    if (done) return;
    done = true;
    input.remove();
    const value = input.value.trim();
    if (commit && value && value !== text) keep(value);
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(false));
  root.appendChild(input);
  input.focus();
  input.select();
}
