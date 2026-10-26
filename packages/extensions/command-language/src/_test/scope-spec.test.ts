/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 * @author Ludovic Autin <autin@scripps.edu>
 */

import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { attributes as ChimeraxAttributes } from '@molstar/query-language/transpilers/chimerax/attributes';
import { selectors as ChimeraxSelectors } from '@molstar/query-language/transpilers/chimerax/selectors';
import { ChimeraxCommands } from '../language/chimerax/commands.js';
import { ChimeraxColors } from '../language/chimerax/colors.js';
import { ChimeraxUnsupported } from '../language/chimerax/unsupported.js';
import { PymolReps, PymolRepsUnsupported } from '../language/pymol/args.js';
import { PymolCommands } from '../language/pymol/commands.js';
import { PymolSettings } from '../language/pymol/settings.js';
import { PymolUnsupported } from '../language/pymol/unsupported.js';
import type { RepType } from '../language/ir.js';
import type { Unsupported } from '../language/table.js';
import { VmdCommands } from '../language/vmd/commands.js';
import { VmdColorMethodNames, VmdStyleNames } from '../language/vmd/styles.js';
import { VmdUnsupported } from '../language/vmd/unsupported.js';
import { MolstarReps } from '../prism-viewer/reps.js';

// The scope tables (_spec/pymol.md, _spec/vmd.md, _spec/chimerax.md) are written from the command tables, so they say what the code
// does. This test fails when a file is not what the code says; `UPDATE_SPEC=1 pnpm test:unit
// packages/extensions/command-language/src/_test/scope-spec.test.ts` writes them.

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const code = (s: string) => `\`${cell(s)}\``;

const molstar = (reps: readonly RepType[] | 'all') =>
  reps === 'all'
    ? 'every type'
    : reps
        .map((r) => {
          const m = MolstarReps[r];
          const extra = [
            m.typeParams
              ? Object.entries(m.typeParams)
                  .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
                  .join(', ')
              : '',
            m.sizeTheme ? `size ${m.sizeTheme.name}` : '',
          ].filter(Boolean);
          return `\`${m.type}\`${extra.length ? ` (${extra.join('; ')})` : ''}`;
        })
        .join(', ');

const unsupportedTable = (list: readonly Unsupported[]) => [
  '| Command | Why | Instead |',
  '| --- | --- | --- |',
  ...list.map((u) => `| ${code(u.name)} | ${cell(u.why)} | ${cell(u.hint ?? '')} |`),
];

function pymol(): string {
  return [
    '# PyMOL: scope',
    '',
    'What the PyMOL dialect does ([README](README.md)), written from the command tables by',
    '`src/_test/scope-spec.test.ts` (`UPDATE_SPEC=1` writes it). An omitted selection is `all`, as in PyMOL.',
    '',
    '## Commands',
    '',
    '| Command | Usage | What it does in Mol\\* |',
    '| --- | --- | --- |',
    ...PymolCommands.map(
      (c) =>
        `| ${code(c.name)}${c.aliases?.length ? ` (${c.aliases.map(code).join(', ')})` : ''} | ${code(c.usage)} | ${cell(c.summary)} |`,
    ),
    '',
    'Also `help [command]`, and `@file.pml` or `load file.pml`: a script given with this one runs in its place.',
    '',
    '## Representations',
    '',
    '| PyMOL | Mol\\* |',
    '| --- | --- |',
    ...Object.entries(PymolReps).map(
      ([k, v]) =>
        `| ${code(k)} | ${molstar(v)}${k === 'nb_spheres' || k === 'nonbonded' ? ', atoms without bonds' : ''} |`,
    ),
    ...Object.entries(PymolRepsUnsupported).map(([k, why]) => `| ${code(k)} | not supported: ${cell(why)} |`),
    '',
    '## Settings',
    '',
    '| Setting | What | Default |',
    '| --- | --- | --- |',
    ...Object.entries(PymolSettings).map(([k, s]) => `| ${code(k)} | ${cell(s.summary)} | ${code(s.default)} |`),
    '',
    'Any other setting fails, naming these.',
    '',
    '## Not supported',
    '',
    ...unsupportedTable(PymolUnsupported),
    '',
  ].join('\n');
}

function vmd(): string {
  return [
    '# VMD: scope',
    '',
    'What the VMD dialect does ([README](README.md)), written from the command tables by',
    '`src/_test/scope-spec.test.ts` (`UPDATE_SPEC=1` writes it). `molid` is a molecule id or `top`; a selection applies',
    'to the command’s molecule. Tcl: `set`, `unset`, `$name`, `[atomselect …]`, `[molinfo top]`, `puts`; atomselect',
    'handles’ `num`, `text`, `molid`, `get`, `delete`.',
    '',
    '## Commands',
    '',
    '| Command | Usage | What it does in Mol\\* |',
    '| --- | --- | --- |',
    ...VmdCommands.map(
      (c) =>
        `| ${code(c.name)}${c.aliases?.length ? ` (${c.aliases.map(code).join(', ')})` : ''} | ${code(c.usage)} | ${cell(c.summary)} |`,
    ),
    '',
    'Also `help [command]`, and `source file.tcl` or `play file.vmd`: a script given with this one runs in its place.',
    '',
    '## Styles and coloring methods',
    '',
    `Styles: ${VmdStyleNames.map(code).join(', ')}. Coloring methods: ${VmdColorMethodNames.map(code).join(', ')}.`,
    'Materials: `Opaque`, `Transparent` (others draw as Opaque, with a warning).',
    '',
    '## Not supported',
    '',
    ...unsupportedTable(VmdUnsupported),
    '',
  ].join('\n');
}

function chimerax(): string {
  const supported = Object.entries(ChimeraxSelectors).filter(([, x]) => x.map);
  const unsupported = Object.entries(ChimeraxSelectors).filter(([, x]) => !x.map);
  return [
    '# ChimeraX: scope',
    '',
    'What the ChimeraX dialect does ([README](README.md)), written from the command tables by',
    '`src/_test/scope-spec.test.ts` (`UPDATE_SPEC=1` writes it). An omitted atom spec is everything, as in ChimeraX.',
    'A command or keyword may be shortened as ChimeraX allows: a command is the first, in ChimeraX 1.10’s order, that',
    'starts with what is typed (`sel` select, `col` color, but `sh` shape); a keyword one that starts with it, any case',
    'when typed in lower case (`tar` target, `bgcolor` bgColor).',
    '',
    '## Commands',
    '',
    '| Command | Usage | What it does in Mol\\* |',
    '| --- | --- | --- |',
    ...ChimeraxCommands.map((c) => `| ${code(c.name)} | ${code(c.usage)} | ${cell(c.summary)} |`),
    '',
    'Also `help [command]` and `usage command`, and `open file.cxc`: a script given with this one runs in its place.',
    'Keywords ChimeraX takes that change nothing here are read and warned about.',
    '',
    '## Colors',
    '',
    `ChimeraX’s ${new Set(ChimeraxColors.values()).size} built-in colors by name (\`red\`, \`cornflower blue\` or`,
    '`cornflowerblue`), `#rgb`, `#rrggbb`, `r,g,b` in percent, `rgb(…)`, `rgba(…)`, `gray(…)`, `hsl(…)`, `hsla(…)`;',
    '`byhetero` and `byelement` with ChimeraX’s element colors; `bychain`, `bypolymer`, `byidentity`, `bymodel` with',
    'Mol*’s themes (Mol*’s palettes).',
    '',
    '## Atom specs',
    '',
    'ChimeraX 1.10’s grammar (query-language’s ChimeraX transpiler): `#1`, `#1-3`, `#1.2`, `/A`, `/A-C`, `:12-20`,',
    '`:ALA`, `@CA`, wildcards (`*`, `?`, `[…]`), `@@` `::` `//` attribute tests, zones (`@<`, `:<`, `/<`, `#<` and',
    '`>`), `~`, `&`, `|` (one precedence, grouped to the right), `sel` (the selection) and the names `name` defines.',
    'Model ids are ChimeraX’s: given at load, the lowest free.',
    '',
    '| Selector | What |',
    '| --- | --- |',
    ...supported.map(([k, x]) => `| ${code(k)} | ${cell(x['@desc'])} |`),
    '| element symbols | `C`, `N`, `Zn`, … (case matters) |',
    '',
    `Not supported: ${unsupported.map(([k]) => code(k)).join(', ')}, and the IDATM atom types.`,
    '',
    '| Level | Attributes |',
    '| --- | --- |',
    ...(['atom', 'residue', 'chain'] as const).map(
      (level) => `| ${level} | ${Object.keys(ChimeraxAttributes[level]).map(code).join(', ')} |`,
    ),
    '',
    '## Targets and atom styles',
    '',
    `Atoms: ${molstar(['sticks', 'ball-and-stick', 'spheres', 'lines'])} (an atom shows in one style: stick, ball or`,
    'sphere, set by `style` and kept for atoms shown later). Cartoons: `cartoon`, `putty`. Surfaces: `molecular-surface`.',
    'Models: the structure’s visibility. Pseudobonds are not drawn.',
    '',
    '## Not supported',
    '',
    ...unsupportedTable(ChimeraxUnsupported),
    '',
    'Any other ChimeraX command fails too, saying it is ChimeraX’s.',
    '',
  ].join('\n');
}

describe('the scope spec', () => {
  for (const [name, text] of [
    ['pymol.md', pymol()],
    ['vmd.md', vmd()],
    ['chimerax.md', chimerax()],
  ] as const) {
    it(`${name} is what the code says`, () => {
      const file = new URL(`../../_spec/${name}`, import.meta.url);
      if (process.env.UPDATE_SPEC) fs.writeFileSync(file, text);
      // a Windows checkout has the file with CRLF line endings
      expect(fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : '').toBe(text);
    });
  }
});
