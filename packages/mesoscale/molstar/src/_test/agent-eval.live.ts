/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Provider } from '@molstar/ai';
import { createAnthropicProvider, createGoogleProvider } from '@molstar/ai/providers';
import { evalReport } from '@molstar/prism-viewer/agent/eval';
import { describe, expect, it } from 'vitest';
import { MesoAgentEvalTasks, runMesoEval } from './agent-eval.tasks.js';
import { stubCanvasForLabels } from './canvas.js';

// The agent's evals on real models (`pnpm test:live`, never in the unit or medium lanes): each task of
// agent-eval.tasks.ts on a headless viewer, graded on the document, the drawn layers and Undo turn; the report (checks,
// tools, tokens) is printed. The models are Prism's live ones (Haiku, Gemini Flash); a key comes from the repository's
// `.env.local` (as Prism's `live-models.ts` reads it) or the environment, is never printed, and a model without one is
// skipped.

stubCanvasForLabels();

function keys(): Record<string, string> {
  const file = path.resolve(import.meta.dirname, '../../../../../.env.local');
  const out: Record<string, string> = {};
  if (fs.existsSync(file))
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n\r]*)"?\s*$/.exec(line);
      if (m) out[m[1]] = m[2];
    }
  for (const k of ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY']) if (!out[k] && process.env[k]) out[k] = process.env[k]!;
  return out;
}

const env = keys();

const Models: readonly { provider: string; model: string; key: string; create: () => Provider }[] = [
  {
    provider: 'anthropic',
    model: 'claude-haiku-5-5',
    key: 'ANTHROPIC_API_KEY',
    create: () => createAnthropicProvider({ resolveApiKey: () => env.ANTHROPIC_API_KEY }),
  },
  {
    provider: 'google',
    model: 'gemini-3.8-flash',
    key: 'GEMINI_API_KEY',
    create: () => createGoogleProvider({ resolveApiKey: () => env.GEMINI_API_KEY }),
  },
];

for (const m of Models) {
  describe.skipIf(!env[m.key])(`the mesoviewspec agent evals on ${m.model}`, () => {
    for (const task of MesoAgentEvalTasks) {
      it(task.title, async () => {
        const provider = m.create();
        const r = await runMesoEval(task, {
          models: {
            providerFor: (p) => (p === m.provider ? provider : undefined),
            default: { provider: m.provider, model: m.model },
          },
        });
        console.info(`${m.model}: ${evalReport(r)}`);
        expect(r.pass, evalReport(r)).toBe(true);
      });
    }
  });
}
