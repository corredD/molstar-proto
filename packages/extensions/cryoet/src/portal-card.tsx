/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { For, ParamsForm, Show } from '@molstar/prism-ui';
import { latest } from '@molstar/prism-ui/dom/scoped';
import { ParamsFormModel } from '@molstar/prism-ui/forms/params-form';
import { mapState } from '@molstar/prism-ui/reactive/map-state';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import { derive } from '@molstar/prism-ui/reactive/state';
import { type CardContext, type CardRunResult, LoadAction, Muted } from './card-common.js';
import type { PortalCatalog, PortalDataset } from './portal-index.js';
import {
  entryBytes,
  levelLine,
  mb,
  type PortalPanelArea,
  portalTiltSeriesOptions,
  portalTomogramOptions,
  type PortalRunInfo,
  type PortalTomogramView,
} from './portal-run.js';

// The CryoET Data Portal's card (_spec/portal.md §4): dataset, run, tomogram (every one of the run, across its
// spacings) and level (with their sizes), a tilt series and its level, the annotations to load, then Load (`cryoetPortal.load`). The fields are a
// `ParamsForm` made from the index; a pick of dataset, run or tomogram makes the form again for what it holds. No viewer import: a story runs it over a fake.

/** What the form is made for: a dataset (read), a run and a tomogram of it (its spacing with it) */
interface RunPick {
  readonly catalog: PortalCatalog;
  readonly dataset: PortalDataset;
  readonly run: string;
  readonly tomogram?: number;
}

export type PortalRunResult = CardRunResult;
export type PortalPanelContext = CardContext;

export function PortalPanel(props: { ctx: PortalPanelContext; area: PortalPanelArea }) {
  const { ctx, area } = props;
  const pick = observableState<RunPick | undefined>(undefined);
  const problem = observableState('');
  // one Load a panel: a pick remakes the form, not the load in flight (night review B4)
  const action = new LoadAction(ctx);
  const read = latest(
    async (
      _signal,
      catalog: PortalCatalog,
      id: number,
      run: string,
      tomogram: number | undefined,
    ): Promise<RunPick> => {
      const dataset = await area.dataset(id);
      return { catalog, dataset, run, tomogram };
    },
  );
  const choose = (catalog: PortalCatalog, id: number, run?: string, tomogram?: number) => {
    problem.set('');
    return read(catalog, id, run ?? '', tomogram).then(
      (p) => {
        if (p) pick.set(p);
        return true;
      },
      (e: unknown) => {
        problem.set((e as Error).message);
        return false;
      },
    );
  };
  area.catalog().then(
    (c) => void (c.datasets.length ? choose(c, c.datasets[0].id) : problem.set('The portal index lists no dataset.')),
    (e: unknown) => void problem.set((e as Error).message),
  );
  const forms = mapState(pick.asReadonly, (p) => (p ? [p] : []));
  return (
    <div style="display: grid; gap: var(--msp-space-3); min-width: 0; padding: 0 var(--msp-space-3) var(--msp-space-3)">
      <Show when={mapState(problem.asReadonly, (m) => !!m)}>{() => <p style={Muted}>{problem.asReadonly}</p>}</Show>
      <For each={forms} by={(p) => `${p.dataset.id}/${p.run}/${p.tomogram ?? ''}`}>
        {(p) => <RunForm action={action} area={area} pick={p} choose={choose} />}
      </For>
    </div>
  );
}

function RunForm(props: {
  action: LoadAction;
  area: PortalPanelArea;
  pick: RunPick;
  choose: (catalog: PortalCatalog, id: number, run?: string, tomogram?: number) => Promise<boolean>;
}) {
  const { action, area, pick, choose } = props;
  const { catalog, dataset } = pick;
  const info = area.describe(dataset, pick.run, undefined, pick.tomogram);
  if ('ok' in info) return <p style={Muted}>{info.message}</p>;
  const params = runParams(catalog, dataset, info);
  const form = new ParamsFormModel(params, undefined, {
    onChange: (v, changed) => {
      // a read that fails puts its select back: the form shows the pick Load sends (EMPIAR's review S6, here B5)
      const back = (ok: boolean) => {
        if (!ok)
          form.load({
            ...form.values.value,
            dataset: String(dataset.id),
            run: info.run.name,
            tomogram: String(info.tomogram?.id ?? ''),
          });
      };
      if (changed === 'dataset') void choose(catalog, Number(v.dataset)).then(back);
      else if (changed === 'run') void choose(catalog, dataset.id, v.run).then(back);
      else if (changed === 'tomogram') void choose(catalog, dataset.id, info.run.name, Number(v.tomogram)).then(back);
    },
  });
  const size = derive(form.values, (v) =>
    mb(bytesOf(info, v.level, v.as, v.annotations) + tiltSeriesBytes(info, v.tiltSeries)),
  );
  const load = () => {
    const v = form.values.value;
    // the size is in view beside Load: no second question past the guard
    void action.run('cryoetPortal.load', {
      dataset: dataset.id,
      run: info.run.name,
      spacing: info.spacing.spacing,
      ...(info.tomogram ? { tomogram: info.tomogram.id, level: Number(v.level) } : {}),
      annotations: v.annotations.length ? v.annotations.join(',') : 'none',
      as: v.as,
      ...(v.tiltSeries.name !== 'none'
        ? { tiltSeries: Number(v.tiltSeries.name), tiltSeriesLevel: Number(v.tiltSeries.params.level) }
        : {}),
      large: true,
    });
  };
  return (
    <div style="display: grid; gap: var(--msp-space-2); min-width: 0">
      <ParamsForm form={form} />
      {dataset.dois.length ? <p style={Muted}>{dataset.dois.map((d) => `doi:${d}`).join(' · ')}</p> : null}
      {action.view({ info: size, onApply: load })}
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
    // every tomogram of the run, across its spacings: one picked sets the spacing, its annotations and levels
    tomogram: PD.Select(t ? String(t.id) : '', portalTomogramOptions(info.run), { isHidden: !t }),
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
      { label: 'Show as', isHidden: !t },
    ),
    // none, or one of the run's: its level (the coarsest first) a row under it
    tiltSeries: PD.MappedStatic('none', tiltSeriesCases(info), {
      label: 'Tilt series',
      options: [['none', 'None'], ...portalTiltSeriesOptions(info.run)] as [string, string][],
      isHidden: !info.run.tiltSeries?.length,
    }),
    annotations: PD.MultiSelect(
      info.defaults as string[],
      info.entries.map((e) => [
        e.key,
        `${e.object} · ${e.shape}${e.count ? ` · ${e.count}` : ''}${e.needs ? ' (needs a reader)' : ''}`,
      ]) as [string, string][],
    ),
  };
}

/** The Tilt series choice's cases: none, or a tilt series by id and its level (a row at the same level) */
function tiltSeriesCases(info: PortalRunInfo) {
  const cases: Record<string, PD.Any> = { none: PD.Group({}, { isFlat: true }) };
  for (const ts of info.run.tiltSeries ?? []) {
    const levels = ts.levels.map((l) => [l.path, levelLine(l)] as [string, string]);
    cases[String(ts.id)] = PD.Group(
      { level: PD.Select(ts.levels[ts.levels.length - 1]?.path ?? '', levels, { label: 'Series level' }) },
      { isFlat: true },
    );
  }
  return cases;
}

/** The tilt series' level picked, its bytes (none: 0) */
function tiltSeriesBytes(info: PortalRunInfo, picked: { name: string; params: { level?: string } }) {
  const ts = info.run.tiltSeries?.find((x) => String(x.id) === picked.name);
  return ts?.levels.find((l) => l.path === picked.params.level)?.bytes ?? 0;
}

function bytesOf(info: PortalRunInfo, level: string, as: PortalTomogramView, keys: readonly string[]) {
  const picked = new Set(keys);
  let n = as === 'none' ? 0 : (info.tomogram?.levels.find((l) => l.path === level)?.bytes ?? 0);
  for (const e of info.entries) if (picked.has(e.key)) n += entryBytes(e, level ? Number(level) : undefined);
  return n;
}
