/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { ActionFooter, For, ParamsForm, Show } from '@molstar/prism-ui';
import { effect } from '@molstar/prism-ui/dom/scope';
import { latest } from '@molstar/prism-ui/dom/scoped';
import { ParamsFormModel } from '@molstar/prism-ui/forms/params-form';
import { mapState } from '@molstar/prism-ui/reactive/map-state';
import { observableState } from '@molstar/prism-ui/reactive/observable-state';
import type { ReadonlyState } from '@molstar/prism-ui/reactive/readonly-state';
import { derive } from '@molstar/prism-ui/reactive/state';
import {
  defaultFiles,
  type EmpiarAsk,
  type EmpiarCondition,
  type EmpiarEntry,
  type EmpiarGrid,
  EmpiarPages,
  empiarIdOf,
  sizeLabel,
  totalLabel,
  ebiSpeedWarning,
} from './empiar-entry.js';
import { type CardContext, type CardRunResult, LoadAction, Muted, readingFlag } from './card-common.js';
import type { FetchProgress } from './load-steps.js';

// The EMPIAR card (_spec/empiar.md §4): an id, then the entry walked live: its condition, grid and run (selects, as the
// portal's card), the run's files that load (checked: what a load takes by default) with their sizes, the ones that do
// not greyed with why, an EMDB average; then Load (`empiar.load`), which asks first above the size threshold. Only the
// last pick's reads land (`latest`). No viewer import: a story runs it over a fake.

/** What the card reads of the `empiar` area (a story gives a fake) */
export interface EmpiarPanelArea {
  entry(id: number): Promise<EmpiarEntry>;
  condition(id: number, root: string): Promise<EmpiarCondition>;
  grid(id: number, root: string, grid: string): Promise<EmpiarGrid>;
  readonly asked: ReadonlyState<EmpiarAsk | undefined>;
  /** The download under way (`empiar.load` fetches before its step); absent: none said */
  readonly fetching?: ReadonlyState<FetchProgress | undefined>;
}

export type EmpiarRunResult = CardRunResult;
export type EmpiarPanelContext = CardContext;

interface RunPick {
  readonly entry: EmpiarEntry;
  readonly conditions: readonly EmpiarCondition[];
  readonly condition: EmpiarCondition;
  readonly grid: EmpiarGrid;
  readonly run: string;
}

export function EmpiarPanel(props: { ctx: EmpiarPanelContext; area: EmpiarPanelArea }) {
  const { ctx, area } = props;
  const idForm = new ParamsFormModel({ id: PD.Text('', { label: 'EMPIAR id', placeholder: 'EMPIAR-12534' }) });
  const pick = observableState<RunPick | undefined>(undefined);
  const problem = observableState('');
  // the Read button's busy: only the latest of overlapping reads clears it (night review B7)
  const reading = readingFlag();
  // one Load a panel: a pick remakes the form, not the load in flight (night review B4)
  const action = new LoadAction(ctx);
  // one pick at a time: a newer one drops what an older one would show (rendering.md §2.7)
  const read = latest(async (_signal, id: number, root?: string, grid?: string, run?: string): Promise<RunPick> => {
    const entry = await area.entry(id);
    if (!entry.conditions.length) throw new Error(`EMPIAR-${id} describes no image set folders.`);
    const conditions = await Promise.all(entry.conditions.map((c) => area.condition(id, c)));
    const byRun = run ? conditions.find((c) => c.grids.some((g) => run.startsWith(`${g}_`))) : undefined;
    const condition = conditions.find((c) => c.root === root) ?? byRun ?? conditions[0];
    const name =
      (grid && condition.grids.includes(grid) ? grid : undefined) ??
      condition.grids.find((g) => run?.startsWith(`${g}_`)) ??
      condition.grids[0];
    if (!name) throw new Error(`${condition.root} has no grid folders.`);
    const g = await area.grid(id, condition.root, name);
    const stem = g.runs.find((r) => r.stem === run)?.stem ?? g.runs[0]?.stem ?? '';
    return { entry, conditions, condition, grid: g, run: stem };
  });
  /** A pick read and shown; false when its read failed (the form goes back to the pick it shows) */
  const choose = (id: number, root?: string, grid?: string, run?: string) => {
    problem.set('');
    return reading.track(read(id, root, grid, run)).then(
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
  const open = () => {
    const id = empiarIdOf(idForm.values.value.id);
    if (id === undefined) problem.set(`'${idForm.values.value.id}' is not an EMPIAR id: give EMPIAR-12534 or 12534.`);
    else void choose(id);
  };
  effect(area.asked, (a) => {
    if (!a) return;
    idForm.set('id', `EMPIAR-${a.id}`);
    void choose(a.id, undefined, undefined, a.run);
  });
  const forms = mapState(pick.asReadonly, (p) => (p ? [p] : []));
  return (
    <div style="display: grid; gap: var(--msp-space-3); min-width: 0; padding: 0 var(--msp-space-3) var(--msp-space-3)">
      <div style="display: grid; gap: var(--msp-space-2); min-width: 0">
        <ParamsForm form={idForm} />
        <ActionFooter icon="search" label="Read" busy={reading.state} onApply={open} />
      </div>
      <Show when={mapState(problem.asReadonly, (m) => !!m)}>{() => <p style={Muted}>{problem.asReadonly}</p>}</Show>
      <For each={forms} by={(p) => `${p.entry.id}/${p.condition.root}/${p.grid.name}/${p.run}`}>
        {(p) => <RunForm action={action} area={area} pick={p} choose={choose} />}
      </For>
    </div>
  );
}

const lastPart = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** A condition by its folder and the words of its first image set (`EMPIAR_upload · … CHX-treated …`) */
function conditionLabel(entry: EmpiarEntry, root: string) {
  const set = entry.imageSets.find((s) => s.directory.startsWith(`${root}/`) && s.category === 'reconstructed volumes');
  return set ? `${lastPart(root)} · ${set.name}` : lastPart(root);
}

function RunForm(props: {
  action: LoadAction;
  area: EmpiarPanelArea;
  pick: RunPick;
  choose: (id: number, root?: string, grid?: string, run?: string) => Promise<boolean>;
}) {
  const { action, area, pick, choose } = props;
  const { entry, condition, grid } = pick;
  const run = grid.runs.find((r) => r.stem === pick.run);
  const loadable = run?.files.filter((f) => !f.why) ?? [];
  const greyed = [...(run?.files.filter((f) => f.why) ?? []), ...grid.other];
  const form = new ParamsFormModel(
    {
      condition: PD.Select(
        condition.root,
        pick.conditions.map((c) => [c.root, conditionLabel(entry, c.root)] as [string, string]),
      ),
      grid: PD.Select(
        grid.name,
        condition.grids.map((g) => [g, g] as [string, string]),
      ),
      run: PD.Select(
        pick.run,
        grid.runs.map((r) => [r.stem, r.stem] as [string, string]),
      ),
      files: PD.MultiSelect(
        run ? defaultFiles(run).map((f) => f.name) : [],
        loadable.map((f) => [f.name, `${f.kind} · ${f.name} · ${sizeLabel(f)}`] as [string, string]),
      ),
      emdb: PD.Select(
        entry.emdb[0] ?? 'none',
        [['none', 'None'], ...entry.emdb.map((e) => [e, `${e}: beside, and on the particles`] as [string, string])],
        { label: 'EMDB average' },
      ),
    },
    undefined,
    {
      onChange: (v, changed) => {
        // a read that fails puts its select back: the form shows the pick Load sends (review S6)
        const back = (ok: boolean) => {
          if (!ok) form.load({ ...form.values.value, condition: condition.root, grid: grid.name, run: pick.run });
        };
        if (changed === 'condition' && v.condition !== condition.root) void choose(entry.id, v.condition).then(back);
        else if (changed === 'grid' && v.grid !== grid.name) void choose(entry.id, condition.root, v.grid).then(back);
        else if (changed === 'run' && v.run !== pick.run) {
          void choose(entry.id, condition.root, grid.name, v.run).then(back);
        }
      },
    },
  );
  const bytes = derive(form.values, (v) =>
    loadable.filter((f) => v.files.includes(f.name)).reduce((n, f) => n + (f.bytes ?? 0), 0),
  );
  const size = mapState(bytes, totalLabel);
  // EBI is often slow: a pick above a few MB says its usual time (Ludo, 2026-11-04; _spec/empiar.md §4)
  const slow = mapState(bytes, (n) => ebiSpeedWarning(n) ?? '');
  // a yes to the size question is for the files it was said for: changing them asks again (review M1)
  const asked = derive(
    form.values,
    (v) => `${condition.root}/${grid.name}/${pick.run}/${[...v.files].sort().join(',')}/${v.emdb}`,
  );
  const load = () => {
    const v = form.values.value;
    void action.run(
      'empiar.load',
      {
        id: entry.id,
        condition: condition.root,
        grid: grid.name,
        run: pick.run,
        files: v.files.join(','),
        emdb: v.emdb,
      },
      asked.value,
    );
  };
  return (
    <div style="display: grid; gap: var(--msp-space-2); min-width: 0">
      <p style="margin: 0; font-size: var(--msp-font-size-sm)">
        <a href={`${EmpiarPages}${entry.id}`} target="_blank" rel="noreferrer">
          EMPIAR-{String(entry.id)}
        </a>{' '}
        {entry.title}
      </p>
      <ParamsForm form={form} />
      {greyed.length ? (
        <ul style={`${Muted}; padding-left: var(--msp-space-4); opacity: 0.7`}>
          {greyed.map((f) => (
            <li>
              {f.name} · {sizeLabel(f)}: {f.why ?? 'not in a run'}
            </li>
          ))}
        </ul>
      ) : null}
      {action.view({ key: asked, info: size, fetching: area.fetching, onApply: load })}
      <Show when={mapState(slow, (m) => !!m)}>{() => <p style={Muted}>{slow}</p>}</Show>
    </div>
  );
}
