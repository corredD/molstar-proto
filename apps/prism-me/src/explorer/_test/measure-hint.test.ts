/** @vitest-environment jsdom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ButtonsType, ModifiersKeys } from '@molstar/core/util/input/input-observer';
import { StructureSelection } from '@molstar/model/model/structure';
import { Script } from '@molstar/model/script/script';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it } from 'vitest';
import { MesoscaleExplorerExtensions } from '../../extensions.js';
import { explorerUI, sceneModelOf } from '../ui.js';

// The explorer's canvas clicks (_spec/ui.md §7), routed by `explorerUI` on a headless viewer with 1CRN: a ⌘/Ctrl+click
// outside selection mode says how to measure and still picks its row; in selection mode it measures, with no hint.

const viewers: PrismViewer[] = [];
const subs: { unsubscribe(): void }[] = [];
afterEach(async () => {
  for (const s of subs.splice(0)) s.unsubscribe();
  for (const v of viewers.splice(0)) await v.dispose();
});

/** A viewer with 1CRN and the explorer's UI wired (its canvas clicks), as the person's */
async function viewer() {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), ...MesoscaleExplorerExtensions] },
  });
  viewers.push(v);
  const crn = new File([readFileSync(resolve(import.meta.dirname, '../../../../../data/examples/1crn.cif'))], '1crn.cif');
  const r = await v.api.load.files({ files: [crn] });
  if (!r.ok) expect.fail(r.message);
  const api = v.api.as({ kind: 'person' });
  explorerUI({ api, sources: v.sources, managers: v.managers });
  const area = api.explorer!;
  const posted: string[] = [];
  subs.push(v.managers.notifications.posted.subscribe((m) => posted.push(m.text)));
  return { v, area, model: sceneModelOf(area)!, posted };
}

/** Residue `seq`'s CA of 1CRN as a pick */
function atom(v: PrismViewer, seq: number) {
  const structure = v.plugin.managers.structure.hierarchy.current.structures[0].cell.obj!.data;
  const selection = Script.getStructureSelection(
    (Q) =>
      Q.struct.generator.atomGroups({
        'residue-test': Q.core.rel.eq([Q.struct.atomProperty.macromolecular.label_seq_id(), seq]),
        'atom-test': Q.core.rel.eq([Q.struct.atomProperty.macromolecular.label_atom_id(), 'CA']),
      }),
    structure,
  );
  return StructureSelection.toLociWithSourceUnits(selection);
}

/** A primary click on the canvas, as Mol*'s interaction behavior gives it */
function click(v: PrismViewer, loci: ReturnType<typeof atom>, modifiers: Partial<ModifiersKeys>) {
  v.plugin.behaviors.interaction.click.next({
    current: { loci },
    buttons: ButtonsType.Flag.Primary,
    button: ButtonsType.Flag.Primary,
    modifiers: ModifiersKeys.create(modifiers),
  });
}

async function until(check: () => boolean, ms = 5000) {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

const hint = (gesture: string) => `Turn on selection mode to measure: ${gesture} two points`;

describe('a ⌘/Ctrl+click on the canvas', () => {
  it('outside selection mode: says to turn selection mode on to measure, and picks its row', async () => {
    const { v, area, model, posted } = await viewer();
    v.plugin.selectionMode = false;
    area.mac = false;
    const row = area.pickedOf(atom(v, 1))!;
    click(v, atom(v, 1), { control: true });
    expect(posted).toContain(hint('Ctrl+click'));
    expect(model.picked.value?.key).toBe(row.key);
    // on a Mac the gesture is ⌘+click, and so the hint says
    area.mac = true;
    click(v, atom(v, 10), { meta: true });
    expect(posted).toContain(hint('⌘+click'));
    // a plain click says nothing about measuring
    const before = posted.length;
    click(v, atom(v, 1), {});
    expect(posted.slice(before).filter((t) => t.startsWith('Turn on selection mode'))).toEqual([]);
  });

  it('in selection mode: measures as before (its first point kept), with no hint', async () => {
    const { v, area, posted } = await viewer();
    v.plugin.selectionMode = true;
    area.mac = false;
    click(v, atom(v, 1), { control: true });
    await until(() => posted.some((t) => t.startsWith('Distance from')));
    expect(posted.filter((t) => t.startsWith('Turn on selection mode'))).toEqual([]);
  });
});
