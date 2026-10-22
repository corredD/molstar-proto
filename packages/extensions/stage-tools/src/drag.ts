/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { dragMatrix, type MoveMode, movedPoint } from './move.js';
import type { StageApi } from './operations.js';

// An object or a label dragged on the canvas (apps/prism-me/_spec/features.md, "Stage tools"): not a view, an
// interaction of one drag, whose listeners go with it (released, or Escape).

/**
 * Moves or turns an object (a structure, a particle list, a volume, a mesh) or a label by dragging: a layer over the
 * canvas takes the pointer (the camera stays), the drawing follows it (`previewMove`: no change of the state), and the
 * release commits it as one step (`stage.move`; a label: its place, `stage.editLabel`); Escape puts it back.
 */
export function startMoveDrag(
  area: StageApi,
  root: HTMLElement,
  anchor: Element | undefined,
  target: string,
  mode: MoveMode,
  label?: { readonly position: readonly [number, number, number] },
) {
  const canvas = anchor as HTMLElement | undefined;
  const bounds = label ? undefined : area.objectBounds(target);
  const center = label ? Vec3.create(...label.position) : bounds ? Vec3.clone(bounds.center) : undefined;
  if (!canvas || !center) return;
  const rect = canvas.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  const layer = document.createElement('div');
  layer.style.cssText = `position: absolute; left: ${rect.left - rootRect.left}px; top: ${rect.top - rootRect.top}px; width: ${rect.width}px; height: ${rect.height}px; z-index: 50; cursor: ${mode === 'move' ? 'move' : 'grab'}; touch-action: none`;
  const hint = document.createElement('div');
  hint.textContent = `${mode === 'move' ? 'Drag to move it' : 'Drag to turn it'} · Esc to cancel`;
  hint.style.cssText =
    'position: absolute; left: 50%; top: 12px; transform: translateX(-50%); padding: 4px 10px; border-radius: 6px; background: var(--msp-color-surface, #222); color: var(--msp-color-text, #eee); font-size: 12px; pointer-events: none';
  layer.appendChild(hint);
  root.appendChild(layer);
  const frame = area.screenFrame(center);
  let from: { x: number; y: number } | undefined;
  let current = Mat4.identity();
  const finish = async (commit: boolean) => {
    layer.remove();
    window.removeEventListener('keydown', onKey, true);
    if (commit && !Mat4.isIdentity(current)) {
      if (label) {
        const p = movedPoint(center, current);
        await area.editLabel({ label: target, x: p[0], y: p[1], z: p[2] } as never);
      } else {
        await area.move({ target, matrix: Array.from(current) } as never);
      }
    }
    // the drawing back to the state's (moved now, or as it was)
    area.previewMove(target, Mat4.identity());
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    void finish(false);
  };
  window.addEventListener('keydown', onKey, true);
  layer.addEventListener('pointerdown', (e) => {
    from = { x: e.clientX, y: e.clientY };
    layer.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  layer.addEventListener('pointermove', (e) => {
    if (!from) return;
    current = dragMatrix(label ? 'move' : mode, e.clientX - from.x, e.clientY - from.y, frame, center);
    area.previewMove(target, current);
  });
  layer.addEventListener('pointerup', () => {
    if (from) void finish(true);
  });
}
