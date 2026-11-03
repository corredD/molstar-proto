/** @vitest-environment jsdom */
/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { DirectVolume } from '@molstar/graphics/geo/geometry/direct-volume/direct-volume';
import { render } from '@molstar/prism-ui/dom/render';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import { paramSections } from '@molstar/prism-ui/forms/params-form';
import { ApiResult } from '@molstar/prism-viewer/api/area';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExplorerApi, RepresentationInfo } from '../operations.js';
import {
  isDirectVolume,
  isIsosurface,
  Sections,
  setLighting,
  type Subject,
  withoutTypeParams,
  withTypeParamsOf,
} from '../properties.js';

// A volume's Direct volume section (_spec/ui.md §4): its direct volumes, not in Isosurface; each its Lighting line
// (one `volume.update`, the type's params as they are now) above its form, which leaves Lighting and the control
// points out; none: Add a direct volume. On fakes: the headless viewer cannot build a direct volume.

afterEach(() => {
  document.body.innerHTML = '';
});

const info = (ref: string, type: string): RepresentationInfo => ({ ref, label: type, type, visible: true });

/** A volume representation's params as its transform defines them (the type's case, a color theme) */
const Params: PD.Params = {
  type: PD.Mapped<any>(
    'direct-volume',
    [
      ['direct-volume', 'Direct Volume'],
      ['isosurface', 'Isosurface'],
    ],
    (name) =>
      PD.Group<any>(
        name === 'direct-volume'
          ? {
              alpha: PD.Numeric(1, { min: 0, max: 1, step: 0.01 }),
              lighting: DirectVolume.Params.lighting,
              controlPoints: PD.LineGraph([]),
            }
          : { isoValue: PD.Numeric(1) },
      ),
  ),
  colorTheme: PD.Mapped<any>(
    'uniform',
    [
      ['uniform', 'Uniform'],
      ['volume-value', 'Volume Value'],
    ],
    (name) => PD.Group<any>(name === 'uniform' ? { value: PD.Color(0xcccccc as never) } : { stops: PD.Value([]) }),
  ),
};

const DirectValues = {
  type: {
    name: 'direct-volume',
    params: {
      alpha: 1,
      lighting: 'local',
      controlPoints: [
        [0.2, 0],
        [0.5, 0.05],
      ],
    },
  },
  colorTheme: { name: 'uniform', params: { value: 0xcccccc } },
};

/** The explorer's API as the section reads it, and the runs it is asked for */
function fakes(reprs: RepresentationInfo[]) {
  const calls: [string, unknown][] = [];
  const transfers: [string, string][] = [];
  const refreshed: number[] = [];
  // Prism's transfer function's model (sources/volume-transfer.ts), as the view reads it
  const transfer = {
    stats: { min: 0, max: 1, mean: 0.1, sigma: 0.2 },
    histogram: observableState({ min: 0, max: 1, counts: [4, 2, 1] }).asReadonly,
    points: observableState([
      { x: 0.2, alpha: 0 },
      { x: 0.5, alpha: 0.05 },
    ]).asReadonly,
    colors: observableState({ kind: 'uniform' as const, color: 0xffffff }).asReadonly,
    logMin: 1e-3,
    presets: () => [],
    unit: observableState<'sigma' | 'absolute'>('sigma').asReadonly,
    setUnit: () => {},
    change: () => {},
    settle: () => {},
    palettes: [],
    colorsAtPeaks: () => {},
    applyPreset: () => {},
    refresh: () => void refreshed.push(1),
  };
  const params = new Map(reprs.map((r) => [r.ref, observableState<Record<string, unknown>>(DirectValues)]));
  const api = {
    run: async (name: string, args: unknown) => (calls.push([name, args]), ApiResult.ok('')),
  };
  const area = {
    representationsState: () => observableState<readonly RepresentationInfo[]>(reprs).asReadonly,
    representationForm: (ref: string) => {
      const values = params.get(ref)?.value;
      return values ? { params: Params, values: values as PD.Values<PD.Params> } : undefined;
    },
    representationParams: (ref: string) => params.get(ref)!.asReadonly,
    volumeTransfer: (_api: unknown, volume: string, rep: string) => (transfers.push([volume, rep]), transfer),
  };
  return { calls, params, api, area, transfers, refreshed };
}

/** A volume picked: its subject, as the section list gives it */
const subjectOf = (f: ReturnType<typeof fakes>): Subject => ({
  api: f.api as never,
  area: f.area as unknown as ExplorerApi,
  picked: { key: 'v', label: 'map.mrc', kind: 'volume', node: { ref: 'v' } },
  parts: observableState(new Map()).asReadonly as never,
  groupByOf: () => undefined,
});
const sectionOf = (id: string) => Sections.find((s) => s.id === id)!;

/** A section's body for the volume picked */
function mount(f: ReturnType<typeof fakes>, id: string) {
  const host = document.createElement('div');
  document.body.append(host);
  render(() => sectionOf(id).render(subjectOf(f)), host);
  return host;
}

const buttonIn = (el: HTMLElement, text: string) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim() === text);
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("a volume's Direct volume section", () => {
  it("splits a volume's representations: isosurfaces in Isosurface, direct volumes in Direct volume", () => {
    const all = [info('s', 'slice'), info('i', 'isosurface'), info('d', 'direct-volume'), info('j', 'isosurface')];
    expect(all.filter(isIsosurface).map((r) => r.ref)).toEqual(['i', 'j']);
    expect(all.filter(isDirectVolume).map((r) => r.ref)).toEqual(['d']);
  });

  it('comes right after Isosurface, its direct volume there alone', async () => {
    const f = fakes([info('i', 'isosurface'), info('d', 'direct-volume')]);
    const ids = Sections.map((s) => s.id);
    expect(ids.indexOf('direct-volume')).toBe(ids.indexOf('isosurface') + 1);
    // for a volume (an isosurface's row: its own form in Isosurface)
    const subject = subjectOf(f);
    expect(sectionOf('direct-volume').when(subject)).toBe(true);
    expect(sectionOf('direct-volume').when({ ...subject, picked: { ...subject.picked, kind: 'isosurface' } })).toBe(
      false,
    );
    expect(mount(f, 'isosurface').querySelector('[aria-label="Lighting"]')).toBeNull();
    expect(mount(f, 'direct-volume').querySelectorAll('[aria-label="Lighting"]')).toHaveLength(1);
  });

  it('switches Lighting in one volume.update: the type and its params as they are now, with it', async () => {
    const f = fakes([info('d', 'direct-volume')]);
    // changed since the form was made (a drag of the transfer function): kept
    f.params.get('d')!.set({ type: { ...DirectValues.type, params: { ...DirectValues.type.params, alpha: 0.5 } } });
    await setLighting(f.api, f.area, 'd', 'volumetric');
    expect(f.calls).toEqual([
      [
        'volume.update',
        {
          node: 'd',
          params: {
            type: {
              name: 'direct-volume',
              params: { ...DirectValues.type.params, alpha: 0.5, lighting: 'volumetric' },
            },
          },
        },
      ],
    ]);
  });

  it('shows Lighting as its own line, its options from the param, following the representation', async () => {
    const f = fakes([info('d', 'direct-volume')]);
    const body = mount(f, 'direct-volume');
    const select = body.querySelector<HTMLElement>('[aria-label="Lighting"]')!;
    expect(select.textContent).toContain('Local');
    select.click();
    await tick();
    const options = Array.from(body.querySelectorAll<HTMLElement>('[role=option]')).map((o) => o.textContent?.trim());
    expect(options).toEqual(['Local', 'Volumetric', 'Neural (experimental)']);
    Array.from(body.querySelectorAll<HTMLElement>('[role=option]'))
      .find((o) => o.textContent?.trim() === 'Volumetric')!
      .click();
    await tick();
    expect(f.calls.map(([name]) => name)).toEqual(['volume.update']);
    // an undo, or the update landed: the line follows the representation
    f.params
      .get('d')!
      .set({ type: { ...DirectValues.type, params: { ...DirectValues.type.params, lighting: 'neural' } } });
    await tick();
    expect(select.textContent).toContain('Neural (experimental)');
  });

  it('its form has no Lighting or control points rows, and a change of it keeps them as they are now', async () => {
    const f = fakes([info('d', 'direct-volume')]);
    const body = mount(f, 'direct-volume');
    expect(body.textContent).not.toMatch(/Control Points/i);
    expect(body.textContent?.match(/Lighting/g)).toHaveLength(1);
    // set above the form after it was made (Lighting, a drag of the transfer function)
    const now = { ...DirectValues.type.params, lighting: 'neural', controlPoints: [[0.1, 0.2]] };
    f.params.get('d')!.set({ type: { ...DirectValues.type, params: now } });
    const range = body.querySelector<HTMLInputElement>('input[type=range]')!;
    range.value = '0.4';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    range.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 250));
    expect(f.calls).toHaveLength(1);
    const [name, args] = f.calls[0] as [string, { params: typeof DirectValues }];
    expect(name).toBe('volume.update');
    expect(args.params.type.params).toEqual({ ...now, alpha: 0.4 });
  });

  it("shows Prism's transfer function (its histogram, ×½ and ×2) under Lighting, read again as the representation changes", async () => {
    const f = fakes([info('d', 'direct-volume')]);
    const body = mount(f, 'direct-volume');
    expect(f.transfers).toEqual([['v', 'd']]);
    const editor = body.querySelector<HTMLElement>('section[aria-label="Transfer function"]')!;
    expect(editor).not.toBeNull();
    expect(editor.querySelector("button[aria-label^='Denser']")).not.toBeNull();
    // after the Lighting line, before the form
    const lighting = body.querySelector('[aria-label="Lighting"]')!;
    expect(lighting.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const before = f.refreshed.length;
    f.params.get('d')!.set({ type: { ...DirectValues.type, params: { ...DirectValues.type.params, alpha: 0.2 } } });
    await tick();
    expect(f.refreshed.length).toBe(before + 1);
  });

  it("a change of its form sends that field alone: the transfer function's colors (its color theme) are not set back", async () => {
    const f = fakes([info('d', 'direct-volume')]);
    const body = mount(f, 'direct-volume');
    // Colors at peaks, after the form was made: the volume-value theme
    const colorTheme = { name: 'volume-value', params: { stops: [1, 2] } };
    f.params.get('d')!.set({ ...DirectValues, colorTheme });
    const range = body.querySelector<HTMLInputElement>('input[type=range]')!;
    range.value = '0.4';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    range.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 250));
    const [, args] = f.calls[0] as [string, { params: Record<string, unknown> }];
    expect(Object.keys(args.params)).toEqual(['type']);
  });

  it('its form follows the representation (an undo, the transfer function), but not over an edit not sent yet', async () => {
    const f = fakes([info('d', 'direct-volume')]);
    const body = mount(f, 'direct-volume');
    const range = body.querySelector<HTMLInputElement>('input[type=range]')!;
    const withAlpha = (alpha: number) => ({
      ...DirectValues,
      type: { ...DirectValues.type, params: { ...DirectValues.type.params, alpha } },
    });
    f.params.get('d')!.set(withAlpha(0.2));
    await tick();
    expect(range.value).toBe('0.2');
    // typed, then the tree changes before the write: the edit is sent
    range.value = '0.6';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    range.dispatchEvent(new Event('change', { bubbles: true }));
    f.params.get('d')!.set(withAlpha(0.3));
    await new Promise((r) => setTimeout(r, 250));
    const [, args] = f.calls[0] as [string, { params: typeof DirectValues }];
    expect(args.params.type.params.alpha).toBe(0.6);
  });

  it("a direct volume's own row: the same Lighting and transfer function in Representation", () => {
    const f = fakes([info('i', 'isosurface'), info('d', 'direct-volume')]);
    const subject = subjectOf(f);
    const picked = { ...subject.picked, kind: 'volume representation', representation: 'd' };
    const host = document.createElement('div');
    document.body.append(host);
    render(() => sectionOf('representation').render({ ...subject, picked }), host);
    expect(host.querySelectorAll('[aria-label="Lighting"]')).toHaveLength(1);
    expect(host.querySelectorAll('section[aria-label="Transfer function"]')).toHaveLength(1);
    expect(f.transfers).toEqual([['v', 'd']]);
  });

  it('none: Add a direct volume, one volume.representation of the volume', async () => {
    const f = fakes([info('i', 'isosurface')]);
    buttonIn(mount(f, 'direct-volume'), 'Add a direct volume')!.click();
    await tick();
    expect(f.calls).toEqual([['volume.representation', { type: 'direct-volume', volume: 'v' }]]);
  });
});

describe("a direct volume's form", () => {
  it('leaves out Lighting and the control points (set above it), the rest kept; other types untouched', () => {
    const hidden = withoutTypeParams(Params, ['lighting', 'controlPoints']);
    const type = hidden.type as PD.Mapped<any>;
    const rows = (name: string) => {
      const group = type.map(name) as PD.Group<any>;
      const { essentials, advanced } = paramSections(group.params);
      return [...essentials, ...advanced].flatMap((s) => s.names);
    };
    expect(rows('direct-volume')).toEqual(['alpha']);
    expect(rows('isosurface')).toEqual(['isoValue']);
    // the definition it was made from is not changed
    expect(
      ((Params.type as PD.Mapped<any>).map('direct-volume') as PD.Group<any>).params.lighting.isHidden,
    ).toBeFalsy();
  });

  it('sends what it leaves out as it is now, not as it was when the form was made', () => {
    const stale = DirectValues as PD.Values<PD.Params>;
    const formChanged = { type: { ...DirectValues.type, params: { ...DirectValues.type.params, alpha: 0.3 } } };
    const now = {
      type: {
        ...DirectValues.type,
        params: { ...DirectValues.type.params, lighting: 'neural', controlPoints: [[0, 0]] },
      },
    };
    expect(withTypeParamsOf(formChanged, now, ['lighting', 'controlPoints'])).toEqual({
      type: { name: 'direct-volume', params: { alpha: 0.3, lighting: 'neural', controlPoints: [[0, 0]] } },
    });
    // another type now (the form is made again): as the form has them
    expect(withTypeParamsOf(stale, { type: { name: 'isosurface', params: {} } }, ['lighting'])).toBe(stale);
  });
});
