/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Vec3 } from '@molstar/core/math/linear-algebra';
import { createRoot, effect, onCleanup } from '@molstar/prism-ui/dom/scope';
import { drag, frames, observeResize, on } from '@molstar/prism-ui/dom/scoped';
import { type ObservableState, observableState } from '@molstar/prism-ui/reactive/observable-state';
import type { PaintOrient } from './paint.js';
import { type Identify, SurfacePoint, surfaceAt } from './pick-surface.js';

// Paint mode (progress/2026-11-08-paint.md, Design 3; apps/prism-me/_spec/ui.md §5, Paint with …): an entity is the
// brush; a stroke is a drag on a layer over the canvas: once a frame the surface under the pointer (its point and
// normal, `surfaceAt`), a point every spacing along the way, each previewed as a disc oriented on the surface (a 2D
// layer, no change of the state); the release paints them, one `mesoscale.paint` (one step). Esc, or Stop painting,
// leaves the mode. Not a view: a mode of the canvas, its listeners in a scope of its own (`createRoot`), gone with it.

/** What a brush paints with: an entity of a particle list (its state ref) */
export interface PaintBrushTarget {
  readonly particles: string;
  readonly entity: number;
  readonly name: string;
}

/** How the brush paints (apps/prism-me/_spec/ui.md §4, Paint) */
export interface PaintSettings {
  /** Å between copies; 0: a copy's diameter (they touch) */
  readonly spacing: number;
  /** How each copy is turned; `auto`: upright on a membrane (+z along the normal), else at random (Decided 2) */
  readonly orient: 'auto' | PaintOrient;
  /** Along the normal (out of the surface toward the viewer, a membrane's outside) or against it */
  readonly side: 'out' | 'in';
  /** A copy's turn about its axis, °; undefined: at random */
  readonly spin?: number;
  /**
   * Where a copy goes (progress/2026-11-08-paint.md, Round 2, Decided 3): on the surface under the pointer, or at a depth
   * along the pointer's ray (the wheel moves it); `auto`: a membrane protein on the surface, anything else at the depth
   */
  readonly place: 'auto' | PaintPlace;
  /**
   * Whether a stroke is a new fibre (Round 2, Decided 4): its copies the fibre's points, a step apart, turned along it;
   * `auto`: when the entity has fibres in its list
   */
  readonly fiber: 'auto' | 'on' | 'off';
  /**
   * A new fibre's sequence (Round 5): one-letter codes, with the entity's bank a unit a letter; its range (1-based,
   * `end` inclusive). Empty: the bank's units at random
   */
  readonly sequence?: string;
  readonly start?: number;
  readonly end?: number;
}

export type PaintPlace = 'surface' | 'depth';

export const DefaultPaintSettings: PaintSettings = {
  spacing: 0,
  orient: 'auto',
  side: 'out',
  place: 'auto',
  fiber: 'auto',
};

/** What painting needs of the viewer: the plugin's canvas and the operation (a fake in tests) */
export interface PaintHost {
  /** The canvas the layer goes over */
  canvas(): HTMLElement | undefined;
  /** The camera's gestures also with Alt held while painting (`withAltCamera`); returns their restoring */
  holdCamera(): () => void;
  /** The pick at a point of the canvas (CSS pixels from its top left) */
  readonly identify: Identify;
  /** The camera's position */
  eye(out: Vec3): Vec3;
  /** The pointer's ray at a point of the canvas (CSS pixels): its origin and unit direction, in the scene */
  ray(x: number, y: number, origin: Vec3, direction: Vec3): boolean;
  /** The distance from the camera to its focus (its target), Å: where a copy at a depth starts */
  focus(): number;
  /**
   * The distances from the eye the camera draws between (its near and far planes, Å), when known (Round 4): a copy at a
   * depth is kept between them, where it and what it paints are seen
   */
  depthRange?(): readonly [near: number, far: number] | undefined;
  /** The membrane at a point when its pick is a membrane particle's (`membraneFrame`); the point as it is else */
  refine(point: SurfacePoint): void;
  /** Whether the brush stands upright in a membrane (a membrane protein): only its copies go on the mid-plane */
  upright(brush: PaintBrushTarget): boolean;
  /** A point of the scene on the canvas: CSS pixels from its top left (out[0], out[1]) */
  project(out: Vec3, p: Vec3): Vec3;
  /** A copy's radius, Å (its spacing's default and the preview's disc) */
  radius(brush: PaintBrushTarget): number;
  /** The brush's fibres' rise, Å, when it makes fibres (its own settings or its file's fibres; Round 3) */
  fiberStep(brush: PaintBrushTarget): number | undefined;
  /**
   * Paints a stroke: one operation (`mesoscale.paint`); `seed`, its random turns' (the copy under the pointer's);
   * `fiber`, the stroke a new fibre
   */
  paint(
    brush: PaintBrushTarget,
    settings: PaintSettings,
    positions: number[],
    normals: number[],
    seed: number,
    fiber: boolean,
  ): Promise<unknown>;
  /** The copy of the brush drawn under the pointer (Round 2), gone with `dispose` */
  cursor(brush: PaintBrushTarget): PaintCursor;
  /** Whether the brush's list is still there */
  has(brush: PaintBrushTarget): boolean;
  /** Calls `fn` on every change of the state (an undo mid-stroke cancels it); returns its removal */
  changed(fn: () => void): () => void;
}

/** The copy under the pointer (progress/2026-11-08-paint.md, Round 2): moved once a frame, hidden off the canvas */
export interface PaintCursor {
  /** Shows it at `position`, turned as a stroke's first copy of `seed` with that normal would be */
  move(position: Vec3, normal: Vec3, settings: PaintSettings, seed: number): void;
  hide(): void;
  dispose(): void;
}

/** Where a brush's copies go: the settings' place, else a membrane protein (`upright`) on the surface, else at a depth */
export function placeOf(settings: PaintSettings, upright: boolean): PaintPlace {
  return settings.place !== 'auto' ? settings.place : upright ? 'surface' : 'depth';
}

/** The pixels between the picks a normal is read from (the canvas's pick is half resolution: two pick pixels) */
const NormalStep = 4;
/** The frames the copy under the pointer waits for a pending pick before it lets it go (review N5) */
const MaxPendingFrames = 30;
/** The pixels between the points of a stroke's way read in one frame */
const WayStep = 4;

/** Paint mode: on with a brush (`start`), off by `stop`, Esc, or when its list goes */
export class PaintMode {
  readonly brush: ObservableState<PaintBrushTarget | undefined> = observableState<PaintBrushTarget | undefined>(
    undefined,
  );
  readonly settings: ObservableState<PaintSettings> = observableState<PaintSettings>(DefaultPaintSettings);
  private end?: () => void;

  constructor(private readonly host: PaintHost) {}

  /** Paints with `brush` (another brush first stops) */
  start(brush: PaintBrushTarget): boolean {
    this.stop();
    const canvas = this.host.canvas();
    if (!canvas) return false;
    this.brush.set(brush);
    this.end = createRoot((dispose) => {
      paintLayer(this, this.host, canvas, brush);
      return dispose;
    });
    return true;
  }

  stop() {
    const end = this.end;
    this.end = undefined;
    end?.();
    if (this.brush.value) this.brush.set(undefined);
  }

  /** The brush's settings changed (a field of the properties) */
  set(patch: Partial<PaintSettings>) {
    this.settings.set({ ...this.settings.value, ...patch });
  }
}

/** A stroke being drawn: its points and normals (the scene's), the last kept */
interface Stroke {
  readonly positions: number[];
  readonly normals: number[];
  /** Where the pointer was last, CSS pixels from the canvas's top left */
  x: number;
  y: number;
  /** Where the stroke was read up to (the way from there to the pointer is read next); NaN: nowhere yet */
  readX: number;
  readY: number;
  pending: boolean;
  /** The canvas's place at the press */
  left: number;
  top: number;
}

const _point = SurfacePoint();
const _eye = Vec3();
const _a = Vec3();
const _b = Vec3();
const _t = Vec3();
const _s = Vec3();
const _sa = Vec3();
const _sb = Vec3();
const _from = Vec3();

/** The layer of a paint mode over `canvas`, in the current scope: its gesture, its preview, its keys */
function paintLayer(mode: PaintMode, host: PaintHost, canvas: HTMLElement, brush: PaintBrushTarget) {
  const root = canvas.closest<HTMLElement>('.msp-root') ?? canvas.parentElement ?? document.body;
  const layer = document.createElement('div');
  layer.className = 'msp-paint-layer';
  layer.style.cssText = 'position: absolute; z-index: 50; cursor: crosshair; touch-action: none';
  layer.setAttribute('aria-label', `Painting with ${brush.name}`);
  const preview = document.createElement('canvas');
  preview.style.cssText = 'position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none';
  const hint = document.createElement('div');
  hint.style.cssText =
    'position: absolute; left: 50%; top: var(--msp-space-3); transform: translateX(-50%); padding: var(--msp-space-1) var(--msp-space-3); border-radius: var(--msp-radius-md); background: var(--msp-color-raised); color: var(--msp-color-text); font-size: var(--msp-font-size-sm); pointer-events: none';
  layer.append(preview, hint);
  root.appendChild(layer);
  const ctx = preview.getContext('2d') ?? undefined;
  const accent = getComputedStyle(root).getPropertyValue('--msp-color-accent').trim() || 'orange';
  const place = () => {
    const rect = canvas.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    layer.style.left = `${rect.left - rootRect.left}px`;
    layer.style.top = `${rect.top - rootRect.top}px`;
    layer.style.width = `${rect.width}px`;
    layer.style.height = `${rect.height}px`;
    const ratio = globalThis.devicePixelRatio || 1;
    preview.width = Math.max(1, Math.round(rect.width * ratio));
    preview.height = Math.max(1, Math.round(rect.height * ratio));
    ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
  };
  place();
  observeResize(canvas, place);

  let stroke: Stroke | undefined;
  let spacing = 0;
  let radius = Math.max(host.radius(brush), 1e-3);
  let upright = host.upright(brush);
  /** Where the stroke's copies go (the settings' place, or the brush's own: `placeOf`) */
  let where: PaintPlace = placeOf(mode.settings.value, upright);
  /** How far along the pointer's ray a copy at a depth goes, Å (Round 2, Decided 2): the camera's focus at the start */
  let depth = Math.max(host.focus(), radius);
  /** A depth kept a copy's radius inside the camera's drawn range (Round 4), when it is wider than a copy */
  const inRange = (d: number) => {
    const range = host.depthRange?.();
    if (!range || range[1] - range[0] <= 2 * radius) return d;
    return Math.min(range[1] - radius, Math.max(range[0] + radius, d));
  };
  /** The brush's fibres' rise (Round 3): undefined when it makes none; read again at each stroke's start */
  let fiberStep = host.fiberStep(brush);
  /** Whether the stroke is a new fibre (the settings' Fibre, or the brush's own: `auto`, when it has fibres) */
  const fiberOf = (s: PaintSettings) => s.fiber === 'on' || (s.fiber === 'auto' && fiberStep !== undefined);
  let fiber = fiberOf(mode.settings.value);
  /** Strokes painted and not committed yet: their own change of the state is not an undo */
  let committing = 0;
  const clear = () => ctx?.clearRect(0, 0, preview.width, preview.height);

  const writeHint = () => {
    const how = where === 'depth' ? `click or drag · wheel: depth ${Math.round(depth)} Å` : 'drag on a surface';
    const what = fiber ? `a fibre of ${brush.name}` : brush.name;
    hint.textContent = `Painting with ${what} · ${how} · Alt to move the camera · Esc to stop`;
  };
  writeHint();

  /** The point at the stroke's depth along the pointer's ray at (x, y), facing the viewer */
  const atDepth = (x: number, y: number): boolean => {
    if (!host.ray(x, y, _eye, _t)) return false;
    Vec3.scaleAndAdd(_point.position, _eye, _t, depth);
    Vec3.negate(_point.normal, _t);
    return true;
  };

  /** Reads the place at (x, y): a point kept a spacing from the last; false while the pick is read */
  const sampleAt = (s: Stroke, x: number, y: number): boolean => {
    if (where === 'depth') {
      if (!atDepth(x, y)) return true;
    } else {
      const r = surfaceAt(host.identify, x, y, NormalStep, host.eye(_eye), _point);
      if (r === 'pending') return false;
      if (!r) return true;
      // a membrane protein in the membrane's mid-plane; anything else on the surface picked (review should-fix 3)
      if (upright) host.refine(_point);
    }
    const k = s.positions.length;
    const p = _point.position;
    const n = _point.normal;
    if (k) {
      Vec3.set(_a, s.positions[k - 3], s.positions[k - 2], s.positions[k - 1]);
      const d = Vec3.distance(_a, p);
      if (d < spacing) return true;
      if (fiber) {
        // a fibre's points exactly a step apart along the way read (review S1): as many as fit from its last point
        Vec3.copy(_from, _a);
        for (let t = spacing; t <= d; t += spacing) {
          Vec3.lerp(_b, _from, p, t / d);
          drawLink(_a, _b);
          s.positions.push(_b[0], _b[1], _b[2]);
          s.normals.push(n[0], n[1], n[2]);
          Vec3.copy(_a, _b);
        }
        return true;
      }
    }
    s.positions.push(p[0], p[1], p[2]);
    s.normals.push(n[0], n[1], n[2]);
    drawDisc(p, n);
    return true;
  };

  /**
   * Reads the way from where the stroke was read to the pointer, every few pixels (a fast drag moves far in a frame;
   * the picks of one scene and camera are one read); false while the pick is read (again next frame, from there)
   */
  const sample = (s: Stroke): boolean => {
    const fromX = Number.isNaN(s.readX) ? s.x : s.readX;
    const fromY = Number.isNaN(s.readY) ? s.y : s.readY;
    const steps = Math.max(1, Math.ceil(Math.hypot(s.x - fromX, s.y - fromY) / WayStep));
    for (let i = Number.isNaN(s.readX) ? steps : 1; i <= steps; ++i) {
      const x = fromX + ((s.x - fromX) * i) / steps;
      const y = fromY + ((s.y - fromY) * i) / steps;
      if (!sampleAt(s, x, y)) return false;
      s.readX = x;
      s.readY = y;
    }
    s.pending = false;
    return true;
  };

  /** A fibre's segment between two points, projected */
  const drawLink = (a: Vec3, b: Vec3) => {
    if (!ctx) return;
    host.project(_sa, a);
    host.project(_sb, b);
    ctx.beginPath();
    ctx.moveTo(_sa[0], _sa[1]);
    ctx.lineTo(_sb[0], _sb[1]);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.9;
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  /** A copy's disc, oriented on the surface: the circle of `radius` about `n`, projected (two tangents' images) */
  const drawDisc = (p: Vec3, n: Vec3) => {
    if (!ctx) return;
    // two tangents of the surface
    Vec3.set(_t, Math.abs(n[0]) < 0.9 ? 1 : 0, Math.abs(n[0]) < 0.9 ? 0 : 1, 0);
    Vec3.normalize(_a, Vec3.cross(_a, n, _t));
    Vec3.cross(_b, n, _a);
    host.project(_s, p);
    host.project(_sa, Vec3.scaleAndAdd(_t, p, _a, radius));
    host.project(_sb, Vec3.scaleAndAdd(_t, p, _b, radius));
    const ratio = globalThis.devicePixelRatio || 1;
    ctx.setTransform(
      ratio * (_sa[0] - _s[0]),
      ratio * (_sa[1] - _s[1]),
      ratio * (_sb[0] - _s[0]),
      ratio * (_sb[1] - _s[1]),
      ratio * _s[0],
      ratio * _s[1],
    );
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, 2 * Math.PI);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    // the accent (Prism's token, read once at the mode's start): an action's color
    ctx.fillStyle = accent;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.35;
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  // once a frame, the pointer's last place read (the pick is read once a scene and camera; its first may be pending)
  const reader = frames(() => {
    if (stroke?.pending && !sample(stroke)) reader.request();
  });
  // the hint written once a frame, however many wheel events
  const hintNext = frames(writeHint);

  // the copy under the pointer (Round 2): where a click puts it, turned as it will be (the next stroke's seed), moved
  // once a frame; hidden off the canvas and while Alt hands the pointer to the camera
  const cursor = host.cursor(brush);
  /** The next stroke's random turns: its first copy is the one under the pointer */
  let seed = nextSeed();
  /** The pointer over the layer, CSS pixels from its top left (the canvas's) */
  let hoverX = 0;
  let hoverY = 0;
  let hovering = false;
  /** Frames a pending pick was read again for this place: a pick that stays pending (a paused canvas) is let go */
  let retries = 0;
  const follow = frames(() => {
    if (!hovering || passing) return cursor.hide();
    if (where === 'depth') {
      if (!atDepth(hoverX, hoverY)) return cursor.hide();
    } else {
      // still during a stroke on a surface: a move redraws, and the stroke's next pick would draw the pick pass again
      // (review S2); the 2D trail shows the stroke
      if (stroke) return;
      const r = surfaceAt(host.identify, hoverX, hoverY, NormalStep, host.eye(_eye), _point);
      if (r === 'pending') {
        if (++retries < MaxPendingFrames) follow.request();
        return;
      }
      if (!r) return cursor.hide();
      if (upright) host.refine(_point);
    }
    cursor.move(_point.position, _point.normal, mode.settings.value, seed);
  });
  on<PointerEvent>(
    layer,
    'pointermove',
    (e) => {
      hoverX = e.offsetX;
      hoverY = e.offsetY;
      hovering = true;
      retries = 0;
      follow.request();
    },
    { passive: true },
  );
  on(layer, 'pointerleave', () => {
    hovering = false;
    follow.request();
  });

  const gesture = drag<Stroke>(layer, {
    start(e) {
      if (e.button !== 0 || e.altKey) return undefined;
      const rect = canvas.getBoundingClientRect();
      const settings = mode.settings.value;
      radius = Math.max(host.radius(brush), 1e-3);
      upright = host.upright(brush);
      where = placeOf(settings, upright);
      // the entity's rise as it is now (its settings changed since the mode started)
      fiberStep = host.fiberStep(brush);
      fiber = fiberOf(settings);
      // a fibre's path read a rise apart (the entity's: the points the decorator makes), else copies that touch
      spacing = settings.spacing > 0 ? settings.spacing : fiber && fiberStep ? fiberStep : 2 * radius;
      clear();
      const s: Stroke = {
        positions: [],
        normals: [],
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        readX: Number.NaN,
        readY: Number.NaN,
        pending: true,
        left: rect.left,
        top: rect.top,
      };
      stroke = s;
      // the press's own place now (a read of the pick: it may be pending, then in the next frame)
      if (!sample(s)) reader.request();
      e.preventDefault();
      return s;
    },
    move(e, s) {
      s.x = e.clientX - s.left;
      s.y = e.clientY - s.top;
      s.pending = true;
      reader.request();
    },
    end(s, how) {
      stroke = undefined;
      // the release's own place, read now when the pick is there
      if (how === 'up' && s.pending) sample(s);
      clear();
      if (how === 'up' && s.positions.length) {
        committing++;
        void host.paint(brush, mode.settings.value, s.positions, s.normals, seed, fiber).finally(() => committing--);
        // the next copy under the pointer: the next stroke's
        seed = nextSeed();
        follow.request();
      }
    },
  });

  // an undo (or any change of the state) while drawing cancels the stroke: it was read on the scene before;
  // the brush's list removed: the mode ends
  const unchanged = host.changed(() => {
    // a stroke's own commit landing while the next is drawn is not one (review should-fix 4)
    if (stroke && !committing) gesture.cancel();
    if (!host.has(brush)) mode.stop();
  });
  // Alt held: the camera (progress/2026-11-08-paint.md, Round 2, Decided 1): the layer lets the pointer through to the
  // canvas, whose gestures also take Alt while the mode is on; never in the middle of a stroke. Read from the keys and
  // from every pointer move (Alt pressed outside the page), reset when the page loses the focus
  const releaseCamera = host.holdCamera();
  let passing = false;
  const pass = (alt: boolean) => {
    if (alt === passing || (alt && stroke)) return;
    passing = alt;
    layer.style.pointerEvents = alt ? 'none' : '';
    // the pointer moves unseen while the camera has it: the copy shows again at its next move over the layer (review N4)
    if (alt) hovering = false;
    follow.request();
  };
  on<KeyboardEvent>(
    window,
    'keydown',
    (e) => {
      if (e.key === 'Alt') {
        // not the browser's menu (Windows moves the focus there on a lone Alt)
        e.preventDefault();
        pass(true);
        return;
      }
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      mode.stop();
    },
    { capture: true },
  );
  on<KeyboardEvent>(
    window,
    'keyup',
    (e) => {
      if (e.key !== 'Alt') return;
      e.preventDefault();
      pass(false);
    },
    { capture: true },
  );
  on<PointerEvent>(window, 'pointermove', (e) => pass(e.altKey), { capture: true, passive: true });
  // the wheel: the depth along the pointer's ray (Round 2, Decided 2), a copy's diameter a notch (100 px of delta);
  // with Alt it reaches the canvas (the layer steps aside) and zooms
  on<WheelEvent>(
    layer,
    'wheel',
    (e) => {
      if (e.altKey) return;
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 100 : e.deltaY;
      depth = inRange(Math.max(radius, depth + (delta / 100) * 2 * radius));
      hintNext.request();
      follow.request();
    },
    { passive: false },
  );
  // the settings changed (Place, Turn in the properties): the hint says where copies go, the copy turns
  effect(mode.settings.asReadonly, (s) => {
    if (stroke) return;
    where = placeOf(s, upright);
    fiber = fiberOf(s);
    hintNext.request();
    follow.request();
  });
  on(window, 'blur', () => pass(false));
  onCleanup(() => {
    unchanged();
    releaseCamera();
    cursor.dispose();
    layer.remove();
  });
}

/** A stroke's seed of random turns */
function nextSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}
