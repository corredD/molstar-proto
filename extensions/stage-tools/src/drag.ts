/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Vec3 } from '@molstar/core/math/linear-algebra';
import { type DragMode, dragClipObject } from './cuts.js';
import type { StageApi } from './operations.js';

// A cut dragged on the canvas (apps/prism-me/_spec/features.md, "Stage tools"): not a view, an interaction of one
// drag, whose listeners go with it (released, or Escape).

/**
 * Drags a cut: a layer over the canvas takes the pointer (the camera stays), the cut follows it (`previewObject`: its
 * uniforms and guide, no change of the state), and the release commits it as one step (`stage.object`); Escape puts
 * it back. Move slides it in the screen's plane, Turn turns it about the screen's axes, Size scales it (drag up).
 */
export function startDrag(
  area: StageApi,
  root: HTMLElement,
  anchor: Element | undefined,
  target: string,
  index: number,
  mode: DragMode,
) {
  const start = area.clipObject(target, index);
  const canvas = anchor as HTMLElement | undefined;
  if (!start || !canvas) return;
  const rect = canvas.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.style.cssText = `position: absolute; left: ${rect.left - rootRect.left}px; top: ${rect.top - rootRect.top}px; width: ${rect.width}px; height: ${rect.height}px; z-index: 50; cursor: ${mode === 'move' ? 'move' : mode === 'rotate' ? 'grab' : 'ns-resize'}; touch-action: none`;
  const hint = document.createElement('div');
  hint.textContent = `${mode === 'move' ? 'Drag to move the cut' : mode === 'rotate' ? 'Drag to turn the cut' : 'Drag up or down to size the cut'} · Esc to cancel`;
  hint.style.cssText =
    'position: absolute; left: 50%; top: 12px; transform: translateX(-50%); padding: 4px 10px; border-radius: 6px; background: var(--msp-color-surface, #222); color: var(--msp-color-text, #eee); font-size: 12px; pointer-events: none';
  layer.appendChild(hint);
  root.appendChild(layer);
  const frame = area.screenFrame(Vec3.clone(start.position));
  let from: { x: number; y: number } | undefined;
  let current = start;
  const finish = (commit: boolean) => {
    layer.remove();
    window.removeEventListener('keydown', onKey, true);
    if (!commit || current === start) {
      area.previewObject(target, index, start);
      return;
    }
    const { position: p, rotation: r, scale: s } = current;
    void area.object({
      target,
      index,
      x: p[0],
      y: p[1],
      z: p[2],
      axisX: r.axis[0],
      axisY: r.axis[1],
      axisZ: r.axis[2],
      angle: r.angle,
      sx: s[0],
      sy: s[1],
      sz: s[2],
    } as never);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    finish(false);
  };
  window.addEventListener('keydown', onKey, true);
  layer.addEventListener('pointerdown', (e) => {
    from = { x: e.clientX, y: e.clientY };
    layer.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  layer.addEventListener('pointermove', (e) => {
    if (!from) return;
    current = dragClipObject(start, mode, e.clientX - from.x, e.clientY - from.y, frame);
    area.previewObject(target, index, current);
  });
  layer.addEventListener('pointerup', () => {
    if (from) finish(true);
  });
}
