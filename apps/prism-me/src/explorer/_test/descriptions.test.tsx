/** @vitest-environment jsdom */
/** @jsxImportSource @molstar/prism-ui/dom */

/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ShellModel } from '@molstar/prism-ui/shell/shell';
import { DefaultPrismViewerSpec } from '@molstar/prism-viewer/default-spec';
import { createPrismViewerHeadless } from '@molstar/prism-viewer/headless';
import type { PrismViewer } from '@molstar/prism-viewer/viewer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MesoscaleExplorerExtensions } from '../../extensions.js';
import { explorerUI } from '../ui.js';

// An entity's description under its name in the properties (_spec/ui.md §4; the Mesoscale Explorer's Focus Info), over
// a headless viewer in jsdom, from a cellPACK mmCIF made here: the Exosome's rows (the sentence in
// `_entity.pdbx_parent_entity_id`, one with a Markdown link) and an MG-like row (its compartment there, `details` a
// function: no description).

const cif = `data_cellpack_descriptions
loop_
_entity.id
_entity.pdbx_description
_entity.details
_entity.pdbx_parent_entity_id
1 root.exosome.surface.proteins.ITG ? 'Integrin alpha-5, important for cell adhesion and signaling.'
2 root.exosome.surface.proteins.CD81 ? 'CD81 antigen PDB entry [5TCX](http://www.rcsb.org/pdb/explore.do?structureId=5TCX)'
3 root.mge.interior.proteins.RNA_POLYMERASE transcription root.mge.interior.proteins

loop_
_atom_site.group_PDB
_atom_site.id
_atom_site.type_symbol
_atom_site.label_atom_id
_atom_site.label_comp_id
_atom_site.label_asym_id
_atom_site.label_entity_id
_atom_site.label_seq_id
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
ATOM 1 C CA ALA A 1 1 0 0 0
ATOM 2 C CA ALA B 2 1 0 0 0
ATOM 3 C CA ALA C 3 1 0 0 0

loop_
_pdbx_struct_assembly_gen.assembly_id
_pdbx_struct_assembly_gen.oper_expression
_pdbx_struct_assembly_gen.asym_id_list
1 '(1)' A,B,C

loop_
_pdbx_struct_oper_list.id
_pdbx_struct_oper_list.matrix[1][1]
_pdbx_struct_oper_list.matrix[1][2]
_pdbx_struct_oper_list.matrix[1][3]
_pdbx_struct_oper_list.matrix[2][1]
_pdbx_struct_oper_list.matrix[2][2]
_pdbx_struct_oper_list.matrix[2][3]
_pdbx_struct_oper_list.matrix[3][1]
_pdbx_struct_oper_list.matrix[3][2]
_pdbx_struct_oper_list.matrix[3][3]
_pdbx_struct_oper_list.vector[1]
_pdbx_struct_oper_list.vector[2]
_pdbx_struct_oper_list.vector[3]
1 1 0 0 0 1 0 0 0 1 0 0 0
`;

const viewers: PrismViewer[] = [];
afterEach(async () => {
  for (const v of viewers.splice(0)) await v.dispose();
  document.body.innerHTML = '';
});

async function until(check: () => boolean, ms = 10000) {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function mounted() {
  const base = DefaultPrismViewerSpec();
  const v = await createPrismViewerHeadless({
    spec: { ...base, extensions: [...(base.extensions ?? []), ...MesoscaleExplorerExtensions] },
  });
  viewers.push(v);
  const l = await v.api.load.files({ files: [new File([cif], 'exosome.cif')] });
  if (!l.ok) throw new Error(l.message);
  const api = v.api.as({ kind: 'person' });
  const ui = explorerUI({ api, sources: v.sources, managers: v.managers });
  const host = document.createElement('div');
  document.body.append(host);
  ui.tabs![0].render.mount(host, { shell: new ShellModel() } as never, undefined as never);
  return host;
}

const rowOf = (host: HTMLElement, label: string) =>
  Array.from(host.querySelectorAll<HTMLElement>('[role=treeitem]'))
    .find((r) => r.querySelector('[data-tip-overflow]')?.textContent === label)
    ?.querySelector<HTMLElement>('[data-tree-row]') ?? undefined;
/** Every folded row unfolded (once a step: its children show after the next render) */
const unfoldAll = (host: HTMLElement) => {
  for (const r of host.querySelectorAll<HTMLElement>('[role=treeitem][aria-expanded=false]')) {
    r.querySelector<HTMLButtonElement>('button[data-tree-toggle]')?.click();
  }
};
const nameShown = (host: HTMLElement) => host.querySelector('[data-properties-name]')?.textContent;
const description = (host: HTMLElement) => host.querySelector<HTMLElement>('[data-properties-description]');

describe("an entity's description in the properties", () => {
  it('shows under its name, a Markdown link as a link (no brackets); none for an entity without one', async () => {
    const host = await mounted();
    await until(() => {
      unfoldAll(host);
      return !!rowOf(host, 'RNA_POLYMERASE') && !!rowOf(host, 'ITG');
    });
    rowOf(host, 'ITG')!.click();
    await until(() => nameShown(host) === 'ITG');
    expect(description(host)?.textContent).toBe('Integrin alpha-5, important for cell adhesion and signaling.');

    rowOf(host, 'CD81')!.click();
    await until(() => nameShown(host) === 'CD81');
    expect(description(host)?.textContent).toBe('CD81 antigen PDB entry 5TCX');
    expect(description(host)?.querySelector('a')?.getAttribute('href')).toBe(
      'http://www.rcsb.org/pdb/explore.do?structureId=5TCX',
    );

    rowOf(host, 'RNA_POLYMERASE')!.click();
    await until(() => nameShown(host) === 'RNA_POLYMERASE');
    expect(description(host)).toBeNull();
  });
});

describe("a portal annotation's words in the properties (Ludo, 2026-11-04: the portal's description and method)", () => {
  it("shows the ribosomes' description, their method on one line, and their GO term as a link", async () => {
    // the ribosomes' ndjson of 10003 TS_08 (two points), nothing else: the decoration and the average fail, warned
    const points = [1, 2].map((x) => JSON.stringify({ type: 'point', location: { x, y: x, z: x } })).join('\n');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(typeof input === 'object' && 'url' in input ? input.url : input);
        return url.endsWith('chloramphenicol_bound_70s_ribosome-1.0_orientedpoint.ndjson')
          ? new Response(points, { status: 200 })
          : new Response('not found', { status: 404 });
      }),
    );
    const base = DefaultPrismViewerSpec();
    const v = await createPrismViewerHeadless({
      spec: { ...base, extensions: [...(base.extensions ?? []), ...MesoscaleExplorerExtensions] },
    });
    viewers.push(v);
    const r = await v.api.run('cryoetPortal.load', { dataset: 10003, run: 'TS_08', annotations: '1212', as: 'none' });
    if (!r.ok) throw new Error(r.message);
    const api = v.api.as({ kind: 'person' });
    const ui = explorerUI({ api, sources: v.sources, managers: v.managers });
    const host = document.createElement('div');
    document.body.append(host);
    ui.tabs![0].render.mount(host, { shell: new ShellModel() } as never, undefined as never);
    const name = 'chloramphenicol_bound_70s_ribosome-1.0_orientedpoint.ndjson';
    await until(() => !!rowOf(host, name));
    rowOf(host, name)!.click();
    await until(() => nameShown(host) === name);
    const text = description(host)?.textContent ?? '';
    expect(text).toContain('cytosolic ribosome: chloramphenicol bound 70S ribosome');
    expect(text).toContain('Template matching + manual filtering + 3D classification filtering');
    const link = description(host)?.querySelector('a');
    expect(link?.textContent).toBe('GO:0022626');
    expect(link?.getAttribute('href')).toBe('https://amigo.geneontology.org/amigo/term/GO:0022626');
  });
});
