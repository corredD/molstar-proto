/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { ActionFooter, For, ParamsForm, Show } from '@molstar/prism-ui';
import { latest } from '@molstar/prism-ui/dom/scoped';
import { ParamsFormModel } from '@molstar/prism-ui/forms/params-form';
import { mapState } from '@molstar/prism-ui/reactive/map-state';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import { derive } from '@molstar/prism-ui/reactive/state';
import type { PortalCatalog, PortalDataset } from './portal-index.js';
import {
  entryBytes,
  levelLine,
  mb,
  type PortalPanelArea,
  type PortalRunInfo,
  type PortalTomogramView,
} from './portal-run.js';

// The CryoET Data Portal's card (_spec/portal.md §4): dataset, run, voxel spacing and level (with their sizes), the
// annotations to load, then Load (`cryoetPortal.load`). The fields are a `ParamsForm` made from the index; a pick of
// dataset, run or spacing makes the form again for what it holds. No viewer import: a story runs it over a fake.

const Muted = 'margin: 0; color: var(--msp-color-text-muted); font-size: var(--msp-font-size-xs)';

/** What the form is made for: a dataset (read), a run and a spacing of it */
interface RunPick {
  readonly catalog: PortalCatalog;
  readonly dataset: PortalDataset;
  readonly run: string;
  readonly spacing?: number;
}

/** What a run of an operation answers, as the card reads it (the viewer's `ApiResult`, without depending on it) */
export type PortalRunResult =
  | { readonly ok: true; readonly did: string; readonly warnings?: readonly string[] }
  | { readonly ok: false; readonly message: string; readonly hint?: string };

/** How the card loads: the viewer's API (`ctx.api`), or a story's fake */
export interface PortalPanelContext {
  readonly api: { run(id: string, values: Record<string, unknown>): Promise<PortalRunResult> };
}

export function PortalPanel(props: { ctx: PortalPanelContext; area: PortalPanelArea }) {
  const { ctx, area } = props;
  const pick = observableState<RunPick | undefined>(undefined);
  const problem = observableState('');
  const read = latest(
    async (_signal, catalog: PortalCatalog, id: number, run: string, spacing: number | undefined): Promise<RunPick> => {
      const dataset = await area.dataset(id);
      return { catalog, dataset, run, spacing };
    },
  );
  const choose = (catalog: PortalCatalog, id: number, run?: string, spacing?: number) =>
    read(catalog, id, run ?? '', spacing).then(
      (p) => p && pick.set(p),
      (e: unknown) => problem.set((e as Error).message),
    );
  area.catalog().then(
    (c) => (c.datasets.length ? choose(c, c.datasets[0].id) : problem.set('The portal index lists no dataset.')),
    (e: unknown) => problem.set((e as Error).message),
  );
  const forms = mapState(pick.asReadonly, (p) => (p ? [p] : []));
  return (
    <div style="display: grid; gap: var(--msp-space-3); min-width: 0; padding: 0 var(--msp-space-3) var(--msp-space-3)">
      <Show when={mapState(problem.asReadonly, (m) => !!m)}>{() => <p style={Muted}>{problem.asReadonly}</p>}</Show>
      <For each={forms} by={(p) => `${p.dataset.id}/${p.run}/${p.spacing ?? ''}`}>
        {(p) => <RunForm ctx={ctx} area={area} pick={p} choose={choose} />}
      </For>
    </div>
  );
}

function RunForm(props: {
  ctx: PortalPanelContext;
  area: PortalPanelArea;
  pick: RunPick;
  choose: (catalog: PortalCatalog, id: number, run?: string, spacing?: number) => void;
}) {
  const { ctx, area, pick, choose } = props;
  const { catalog, dataset } = pick;
  const info = area.describe(dataset, pick.run, pick.spacing);
  if ('ok' in info) return <p style={Muted}>{info.message}</p>;
  const params = runParams(catalog, dataset, info);
  const form = new ParamsFormModel(params, undefined, {
    onChange: (v, changed) => {
      if (changed === 'dataset') choose(catalog, Number(v.dataset));
      else if (changed === 'run') choose(catalog, dataset.id, v.run);
      else if (changed === 'spacing') choose(catalog, dataset.id, info.run.name, Number(v.spacing));
    },
  });
  const busy = observableState(false);
  const said = observableState('');
  const size = derive(form.values, (v) => mb(bytesOf(info, v.level, v.as, v.annotations)));
  const load = async () => {
    const v = form.values.value;
    busy.set(true);
    try {
      // the size is in view beside Load: no second question past the guard
      const r = await ctx.api.run('cryoetPortal.load', {
        dataset: dataset.id,
        run: info.run.name,
        spacing: info.spacing.spacing,
        ...(info.tomogram ? { tomogram: info.tomogram.id, level: Number(v.level) } : {}),
        annotations: v.annotations.length ? v.annotations.join(',') : 'none',
        as: v.as,
        large: true,
      });
      said.set(r.ok ? [r.did, ...(r.warnings ?? [])].join(' ') : `${r.message}${r.hint ? ` ${r.hint}` : ''}`);
    } catch (e) {
      // a load that threw (a format's error out of the state's update) says so, and Load comes back
      said.set((e as Error).message ?? String(e));
    } finally {
      busy.set(false);
    }
  };
  return (
    <div style="display: grid; gap: var(--msp-space-2); min-width: 0">
      <ParamsForm form={form} />
      {dataset.dois.length ? <p style={Muted}>{dataset.dois.map((d) => `doi:${d}`).join(' · ')}</p> : null}
      <ActionFooter icon="download" label="Load" busy={busy.asReadonly} info={size} onApply={() => void load()} />
      <Show when={mapState(said.asReadonly, (m) => !!m)}>{() => <p style={Muted}>{said.asReadonly}</p>}</Show>
    </div>
  );
}

/** The form's fields for a run: every choice labelled with its size, an entry the viewer cannot read yet said so */
function runParams(catalog: PortalCatalog, ds: PortalDataset, info: PortalRunInfo) {
  const t = info.tomogram;
  const levels = t?.levels ?? [];
  return {
    dataset: PD.Select(
      String(ds.id),
      catalog.datasets.map((d) => [String(d.id), `${d.id} · ${d.title}`] as [string, string]),
    ),
    run: PD.Select(
      info.run.name,
      ds.runList.map((r) => [r.name, r.name] as [string, string]),
    ),
    spacing: PD.Select(
      String(info.spacing.spacing),
      info.run.spacings.map((s) => [String(s.spacing), `${s.spacing} Å`] as [string, string]),
      { isHidden: info.run.spacings.length < 2 },
    ),
    level: PD.Select(
      levels.length ? levels[levels.length - 1].path : '',
      levels.map((l) => [l.path, levelLine(l)] as [string, string]),
      { isHidden: !levels.length, description: info.needs },
    ),
    as: PD.Select<PortalTomogramView>(
      'both',
      [
        ['both', 'Slices and a direct volume'],
        ['slices', 'Slices'],
        ['none', 'No tomogram'],
      ],
      { label: 'Tomogram', isHidden: !t },
    ),
    annotations: PD.MultiSelect(
      info.defaults as string[],
      info.entries.map((e) => [
        e.key,
        `${e.object} · ${e.shape}${e.count ? ` · ${e.count}` : ''}${e.needs ? ' (needs a reader)' : ''}`,
      ]) as [string, string][],
    ),
  };
}

function bytesOf(info: PortalRunInfo, level: string, as: PortalTomogramView, keys: readonly string[]) {
  const picked = new Set(keys);
  let n = as === 'none' ? 0 : (info.tomogram?.levels.find((l) => l.path === level)?.bytes ?? 0);
  for (const e of info.entries) if (picked.has(e.key)) n += entryBytes(e, level ? Number(level) : undefined);
  return n;
}
