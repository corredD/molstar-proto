/**
 * Copyright (c) 2026 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Ludovic Autin <autin@scripps.edu>
 */

import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { describe, expect, it } from 'vitest';
import { expectOk, headlessViewer } from '../../_test/harness.js';
import { ApiArea, type ApiAreaContext, ApiResult } from '../area.js';
import type { LazyViewerExtension, ViewerExtension } from '../../spec.js';

// A lazy stub's `owns.opens` (viewer-spec.md §3): `load.files` runs the operation with `{ file, files }` for a file the
// stub claims (by extension, or by its sniff), and opens the drop's other files as its resources, not data.

interface Call {
  readonly name: string;
  readonly files: readonly string[];
}

const demoExtension = (calls: Call[]): ViewerExtension => {
  class DemoApi extends ApiArea {
    readonly id = 'demo';
    readonly open = this.operation({
      id: 'demo.open',
      title: 'Open a demo document',
      params: { file: PD.Value<File | null>(null), files: PD.Value<readonly File[]>([]) },
      async run({ file, files }) {
        calls.push({ name: file!.name, files: files.map((f) => f.name) });
        return ApiResult.ok(`Opened ${file!.name}.`, {});
      },
    });
  }
  return { id: 'demo', title: 'Demo', api: { demo: (ctx: ApiAreaContext) => new DemoApi(ctx) } };
};

const lazyDemo = (calls: Call[]): LazyViewerExtension => ({
  id: 'demo',
  title: 'Demo',
  stub: {
    parts: [],
    operations: [{ id: 'demo.open', title: 'Open a demo document' }],
    owns: {
      fileExtensions: ['demo'],
      sniff: {
        extensions: ['json'],
        test: (_f, content) =>
          /"format"\s*:\s*"demo"/.test(typeof content === 'string' ? content : new TextDecoder().decode(content)),
      },
      opens: 'demo.open',
    },
  },
  load: async () => demoExtension(calls),
});

const text = (name: string, body: string) => new File([body], name);

describe('load.files with a stub that opens documents', () => {
  it('runs the operation for a file its extension claims', async () => {
    const calls: Call[] = [];
    const v = await headlessViewer({ extensions: [lazyDemo(calls)] });
    const r = await v.api.load.files({ files: [text('a.demo', 'x')] });
    expectOk(r);
    expect(calls).toEqual([{ name: 'a.demo', files: [] }]);
    expect(r.did).toBe('Opened a.demo.');
    expect(v.extensions.status('demo')?.value).toBe('loaded');
  });

  it('runs it for a sniffed file, with the other files as its resources and none opened as data', async () => {
    const calls: Call[] = [];
    const v = await headlessViewer({ extensions: [lazyDemo(calls)] });
    const r = await v.api.load.files({
      files: [text('b.json', '{"format": "demo"}'), text('c.txt', 'resource')],
    });
    expectOk(r);
    expect(calls).toEqual([{ name: 'b.json', files: ['c.txt'] }]);
    expect(r.changed.nodes ?? []).toEqual([]);
    expect(r.warnings).toBeUndefined();
    expect(v.plugin.managers.structure.hierarchy.current.structures).toHaveLength(0);
  });

  it('does not route a json file it does not claim', async () => {
    const calls: Call[] = [];
    const v = await headlessViewer({ extensions: [lazyDemo(calls)] });
    const r = await v.api.load.files({ files: [text('d.json', '{"format": "other"}')] });
    expect(calls).toEqual([]);
    expect(r).toMatchObject({ ok: false, code: 'failed' });
    expect(v.extensions.status('demo')?.value).toBe('stub');
  });

  it('returns the failure of the operation', async () => {
    const calls: Call[] = [];
    const lazy = lazyDemo(calls);
    const failing: ViewerExtension = {
      id: 'demo',
      title: 'Demo',
      api: {
        demo: (ctx: ApiAreaContext) =>
          new (class extends ApiArea {
            readonly id = 'demo';
            readonly open = this.operation({
              id: 'demo.open',
              title: 'Open a demo document',
              params: { file: PD.Value<File | null>(null), files: PD.Value<readonly File[]>([]) },
              async run() {
                return ApiResult.fail('invalid', 'Not a demo.');
              },
            });
          })(ctx),
      },
    };
    const v = await headlessViewer({ extensions: [{ ...lazy, load: async () => failing }] });
    const r = await v.api.load.files({ files: [text('a.demo', 'x')] });
    expect(r).toMatchObject({ ok: false, code: 'invalid', message: 'Not a demo.' });
  });
});
