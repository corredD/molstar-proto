/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { Grid, type Volume } from '@molstar/model/model/volume';
import { type ApiContext, type ApiFailure, ApiResult } from '@molstar/prism-viewer/api/area';
import { isFailure } from '@molstar/prism-viewer/api/scope';

// The scene steps a cryo-ET source's load shares (the portal's, EMPIAR's), by the viewer's operations. Apart from
// `load-steps.ts` (fetches, progress, the cards' words), which the cards import and so stays without the viewer; apart
// from `portal.ts`, so a source does not pull another's readers and index.

/**
 * Above this many bytes a load asks first (`large: true` goes on): a browser tab holds about 2 GB, and a level of a
 * tomogram 8 times smaller is one step coarser (_spec/portal.md §3)
 */
export const LargeBytes = 512e6;

/** The size guard: above `LargeBytes`, unless said `large`, the load is asked about first (a `confirm` failure) */
export function sizeGuard(bytes: number, large: boolean, ask: () => [message: string, hint: string]) {
  if (bytes <= LargeBytes || large) return undefined;
  const [message, hint] = ask();
  return ApiResult.fail('confirm', message, hint);
}

/** A load's answer: what it loaded (`done`) with its warnings; nothing loaded, a failure that gives the warnings */
export function loadResult(name: string, loaded: string, done: readonly string[], warnings: string[]): ApiResult {
  if (!done.length) return ApiResult.fail('unavailable', `Nothing of ${name} could be loaded.`, warnings.join(' '));
  return ApiResult.ok(`Loaded ${loaded}: ${done.join(', ')}.`, {}, { warnings });
}

export const listRefs = (ctx: ApiContext) =>
  new Set(ctx.plugin.managers.particles.hierarchy.current.lists.map((l) => l.cell.transform.ref));
export const volumeRefs = (ctx: ApiContext) =>
  new Set(ctx.plugin.managers.volume.hierarchy.current.volumes.map((v) => v.cell.transform.ref));

/** What a run of `work` added, of a kind */
export async function added(
  ctx: ApiContext,
  refs: (ctx: ApiContext) => Set<string>,
  work: () => Promise<ApiResult>,
): Promise<string[] | ApiFailure> {
  const before = refs(ctx);
  const r = await work();
  if (!r.ok) return r;
  return [...refs(ctx)].filter((x) => !before.has(x));
}

/**
 * An average's (EMDB map's) direct volume lit volumetric, its isosurface hidden: a dense map, where the volume's own
 * shadows show (a tomogram's are faint in its noise)
 */
export async function showAverageVolume(ctx: Pick<ApiContext, 'api'>, volume: string): Promise<ApiResult> {
  const r = await ctx.api.run('volume.representation', {
    volume,
    type: 'direct-volume',
    params: { lighting: 'volumetric' },
  });
  if (!r.ok) return r;
  return ctx.api.run('volume.visibility', { volume, representation: 'isosurface', visible: false });
}

/**
 * The radius (Å) of points without a decoration (Ludo, 2026-11-03): the particle-size theme's own fallback, half the
 * typical distance between neighbors, is a sphere hundreds of Å across for a few sparse picks (10453's 4 V-ATPases:
 * about 900 Å)
 */
export const PointRadius = 50;

/**
 * The list's spheres at `PointRadius`: their size theme's, not the list's radii, so a shape that decorates the list later
 * is not scaled by them (a shape target scales by the particle's radius)
 */
export async function sizePoints(ctx: ApiContext, particles: string): Promise<ApiResult> {
  const list = ctx.plugin.managers.particles.hierarchy.current.lists.find((l) => l.cell.transform.ref === particles);
  for (const r of list?.representations ?? []) {
    if (r.cell.transform.params?.type.name !== 'spacefill') continue;
    const u = await ctx.api.run('particles.update', {
      node: `#${r.cell.transform.ref}`,
      params: { sizeTheme: { name: 'particle-size', params: { scale: 1, defaultSize: PointRadius } } },
    });
    if (!u.ok) return u;
  }
  return ApiResult.ok('');
}

/**
 * An EMDB average (`load.entry`) beside the tomogram, its direct volume shown: its ref, or undefined and a warning. Done
 * only when the entry made a volume: one already in the scene is "already loaded", a volume this load did not make.
 */
export async function loadAverage(ctx: ApiContext, emdb: string, warnings: string[]): Promise<string | undefined> {
  let said = '';
  const made = await added(ctx, volumeRefs, async () => {
    const r = await ctx.api.run('load.entry', { source: 'emdb', id: emdb });
    if (r.ok) said = r.did;
    return r;
  });
  if (isFailure(made) || !made.length) {
    warnings.push(`${emdb}: ${isFailure(made) ? made.message : `not loaded${said ? ` (${said})` : ''}`}`);
    return undefined;
  }
  // one map, one volume
  const [average] = made;
  await besideTheTomogram(ctx, average);
  const d = await showAverageVolume(ctx, average);
  if (!d.ok) warnings.push(`${emdb}: no direct volume: ${d.message}`);
  return average;
}

/**
 * An average beside the tomogram (its own place is the origin, the tomogram's corner): moved along -x by its width and a
 * margin (`besideMatrix`), by the stage's move when the viewer has it
 */
export async function besideTheTomogram(ctx: ApiContext, ref: string) {
  const data = ctx.plugin.state.data.cells.get(ref)?.obj?.data as Volume | undefined;
  if (!data || !ctx.api.describe('stage.move')) return;
  await ctx.api.run('stage.move', { target: ref, matrix: Array.from(besideMatrix(data.grid)) });
}

/** Beside the tomogram, from the origin: along -x by 2.5 times the volume's radius (its width and a margin) */
export function besideMatrix(grid: Grid) {
  const { radius } = Grid.getBoundingSphere(grid);
  return Mat4.fromTranslation(Mat4(), Vec3.create(-2.5 * radius, 0, 0));
}

/** The address of the download a cell's data came from, the first above it */
export function downloadUrlAbove(ctx: Pick<ApiContext, 'plugin'>, ref: string): string | undefined {
  const { cells } = ctx.plugin.state.data;
  for (let cell = cells.get(ref); cell; cell = cells.get(cell.transform.parent)) {
    const url = (cell.transform.params as { url?: unknown } | undefined)?.url;
    if (typeof url === 'string') return url;
    if (url && typeof (url as { url?: unknown }).url === 'string') return (url as { url: string }).url;
    if (cell.transform.ref === cell.transform.parent) break;
  }
  return undefined;
}
