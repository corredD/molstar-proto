/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

// @module-tag medium

import { type ModelStep, scriptedModel } from '@molstar/ai/testing';
import { evalReport } from '@molstar/prism-viewer/agent/eval';
import { describe, expect, it } from 'vitest';
import { drawnCopies, isRed, MesoAgentEvalTasks, openForEval, runMesoEval } from './agent-eval.tasks.js';
import { stubCanvasForLabels } from './canvas.js';

// The agent's evals (agent-eval.tasks.ts) with scripted models: the graders themselves under test. Each task passes
// done right by two routes (other tools or other addresses: the outcome is checked, not the calls), and fails each near
// miss on the check meant to catch it. Showing one of the document's views is a right outcome, and a step Undo turn
// takes back (Ludo, 2026-11-10): its run passes every check, the undo ones included.

stubCanvasForLabels();

const call = (tool: string, args: Record<string, unknown> = {}) => ({ tool, arguments: args as never });
const disclose = call('disclose_skills', { skills: ['mesoviewspec'] });
const task = (id: string) => MesoAgentEvalTasks.find((t) => t.id === id)!;
/** One step of calls after the skill is disclosed, then the model's words. */
const doing = (...calls: ReturnType<typeof call>[]): ModelStep[] => [
  { calls: [disclose] },
  { calls },
  { text: 'Done.' },
];

async function run(id: string, script: ModelStep[]) {
  const model = scriptedModel(script);
  return runMesoEval(task(id), {
    models: {
      providerFor: (p) => (p === 'scripted' ? model.provider : undefined),
      default: { provider: 'scripted', model: 'scripted' },
    },
  });
}

const failed = (r: Awaited<ReturnType<typeof run>>) => r.checks.filter((c) => !c.pass).map((c) => c.name);

interface Case {
  readonly name: string;
  readonly script: ModelStep[];
}

/** Each task: right routes (all pass), near misses (each with the check that must fail). */
const Cases: Record<string, { right: Case[]; near: (Case & { fails: string })[] }> = {
  'hide-lipids-red-catalase': {
    right: [
      {
        name: 'two looks by population',
        script: doing(
          call('style_meso', { select: '(population p.lipids)', visible: false }),
          call('style_meso', { select: '(population p.catalase)', color: 'red' }),
        ),
      },
      {
        name: 'two looks by entity, the picked catalase red too',
        script: doing(
          call('style_meso', { select: '(entity e.lipid)', visible: false }),
          call('style_meso', { select: '(entity e.catalase)', color: '#ff0000' }),
        ),
      },
    ],
    near: [
      {
        name: 'catalase red, the lipids still shown',
        script: doing(call('style_meso', { select: '(population p.catalase)', color: 'red' })),
        fails: 'document: p.lipids hidden',
      },
      {
        name: 'the lipids hidden, catalase left in its own reddish color',
        script: doing(
          call('style_meso', { select: '(population p.lipids)', visible: false }),
          call('style_meso', { select: '(population p.catalase)', color: '#d0453a' }),
        ),
        fails: 'document: p.catalase red',
      },
      {
        name: 'the lipids hidden, the whole exosome red',
        script: doing(
          call('style_meso', { select: '(population p.lipids)', visible: false }),
          call('style_meso', { select: '(in c.exosome)', color: 'red' }),
        ),
        fails: 'document: nothing else red',
      },
      {
        name: 'only catalase shown, red',
        script: doing(
          call('show_only_meso', { select: '(population p.catalase)' }),
          call('style_meso', { select: '(population p.catalase)', color: 'red' }),
        ),
        fails: 'document: nothing else hidden',
      },
    ],
  },
  'lumen-only': {
    right: [
      {
        name: 'Show only the interior of the exosome',
        script: doing(call('show_only_meso', { select: '(in c.exosome :location interior)' })),
      },
      {
        name: 'the medium and the lipids hidden, the membrane proteins kept',
        script: doing(
          call('style_meso', { select: '(in medium :nested false)', visible: false }),
          call('style_meso', { select: '(population p.lipids)', visible: false }),
        ),
      },
    ],
    near: [
      {
        name: 'Show only the exosome: its lipids too',
        script: doing(call('show_only_meso', { select: '(in c.exosome)' })),
        fails: 'document: p.lipids hidden',
      },
      {
        name: 'the medium hidden only',
        script: doing(call('style_meso', { select: '(in medium :nested false)', visible: false })),
        fails: 'document: p.lipids hidden',
      },
      {
        name: 'the lipids hidden only',
        script: doing(call('style_meso', { select: '(population p.lipids)', visible: false })),
        fails: 'document: the medium hidden',
      },
      {
        name: 'only the catalase shown',
        script: doing(call('show_only_meso', { select: '(population p.catalase)' })),
        fails: 'document: the lumen shown',
      },
    ],
  },
  'frame-docked-granule': {
    right: [
      { name: 'Focus on the instance', script: doing(call('focus_meso', { select: '(instance i.granule-docked)' })) },
      {
        name: "Focus on the docked granule's VAMP2",
        script: doing(call('focus_meso', { select: '(part (instance i.granule-docked) p.Vamp2)' })),
      },
    ],
    near: [
      {
        name: 'Focus on all the granules',
        script: doing(call('focus_meso', { select: '(population p.granules)' })),
        fails: 'framed: on the docked granule',
      },
      {
        name: 'Focus on the whole slice',
        script: doing(call('focus_meso', { select: '(all)' })),
        fails: 'framed: on the docked granule',
      },
      {
        name: 'Focus on the other named granule',
        script: doing(call('focus_meso', { select: '(instance i.granule-deep)' })),
        fails: 'framed: on the docked granule',
      },
      {
        name: 'no framing, only words',
        script: [{ calls: [disclose] }, { text: 'The docked granule is at the bottom of the cell.' }],
        fails: 'the camera was asked to frame something',
      },
    ],
  },
};

describe('the agent evals (prism.md §8), graded with scripted models', () => {
  it('has the three tasks of the brief, each with its cases', () => {
    expect(MesoAgentEvalTasks.map((t) => t.id).sort()).toEqual(Object.keys(Cases).sort());
  });

  for (const t of MesoAgentEvalTasks) {
    for (const c of Cases[t.id].right)
      it(`passes "${t.id}" done right: ${c.name}; Undo turn restores the document and the layers`, {
        tags: ['medium'],
        timeout: 60_000,
      }, async () => {
        const r = await run(t.id, c.script);
        expect(r.pass, evalReport(r)).toBe(true);
        expect(r.runs.some((x) => x.origin.kind === 'agent')).toBe(true);
      });

    for (const c of Cases[t.id].near)
      it(`rejects "${t.id}" near miss: ${c.name}`, { tags: ['medium'], timeout: 60_000 }, async () => {
        const r = await run(t.id, c.script);
        expect(r.pass, evalReport(r)).toBe(false);
        expect(failed(r), evalReport(r)).toContain(c.fails);
      });
  }

  it('shows the document’s own "Lumen only" view: every check passes, Undo turn takes it back, nothing asked', {
    tags: ['medium'],
    timeout: 60_000,
  }, async () => {
    const r = await run('lumen-only', doing(call('show_meso_view', { view: 'v.lumen' })));
    expect(r.turns[0].approvals).toBe(0);
    expect(failed(r), evalReport(r)).toEqual([]);
  });

  it('shows the β-cell’s docked view: framed on the granule, and Undo turn takes it back', {
    tags: ['medium'],
    timeout: 60_000,
  }, async () => {
    const r = await run('frame-docked-granule', doing(call('show_meso_view', { view: 'v.docked' })));
    expect(failed(r), evalReport(r)).toEqual([]);
  });

  it('reads the drawn layers as Prism draws them: the overview’s colors and transparency, before any turn', {
    tags: ['medium'],
    timeout: 60_000,
  }, async () => {
    const { v, api } = await openForEval('exosome');
    try {
      const catalase = drawnCopies(v, api, '(population p.catalase)');
      expect(catalase.copies).toBeGreaterThan(0);
      expect([catalase.visible, [...catalase.colors.keys()]]).toEqual([catalase.copies, [0xd0453a]]);
      const lipids = drawnCopies(v, api, '(population p.lipids)');
      expect([lipids.visible, [...lipids.colors.keys()]]).toEqual([lipids.copies, [0xe8d8b0]]);
      // hidden by the person through the document: the layers say so too
      const person = v.api.as({ kind: 'person' });
      expect((await person.run('mesoviewspec.eye', { select: '(population p.lipids)', visible: false })).ok).toBe(true);
      expect(drawnCopies(v, api, '(population p.lipids)').visible).toBe(0);
    } finally {
      await v.dispose();
    }
  });

  it('calls red what is red, not the document’s own catalase color', () => {
    for (const c of [0xff0000, 0xdc143c, 0xb22222, 0xe00000]) expect([c, isRed(c)]).toEqual([c, true]);
    for (const c of [0xd0453a, 0xff6347, 0xffb000, 0x800000, undefined]) expect([c, isRed(c)]).toEqual([c, false]);
  });
});
