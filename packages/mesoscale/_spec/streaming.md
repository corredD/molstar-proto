# MesoViewSpec: Streaming

How a document names data too large to hold at once: the source, the tile manifest, the provider, the planner and the IR
it makes. The concepts and terms are in [README.md](README.md); the reasons and the numbers are in
[design.md](design.md).

## Streaming

David, after v0.1: "it needs … streaming concepts". A document can name a scene too large to hold at once (L in
[design.md](design.md#81-budgets-and-complexity-target): the yeast cell's 2.5 × 10⁷ copies in 6,416 tiles of 200 nm).
The viewer shows all of it coarse first, then loads copies where the camera looks, within a budget.

**Levels** (decision 12, as a runtime concept; the document's sections do not move):

| Level | Holds                                                         | Today                                            |
| ----- | ------------------------------------------------------------- | ------------------------------------------------ |
| 0     | statistical: per tile, a count and an envelope per population | always loaded, from the manifest; never budgeted |
| 1     | copies: one placement set per tile                            | loaded around the focus, within the budget       |
| 2     | atoms: the structures at those poses                          | declared in a manifest, never loaded             |

**The rules, in one place:**

- Streaming is outside `compile`. `compile` loads the manifest and emits one `stream` IR node with level 0 and no
  placement set. The session splices loaded tiles into that node as `placements` children. `planCommit` and the adapter
  see ordinary sets and need no change.
- One set per tile, keyed. A tile's key does not change while the manifest and the stream's types do not, so a stream
  step commits only the tiles added and removed (decision 5).
- The camera reads level 0, never the loaded copies. A focus that picks streamed populations frames their level-0
  envelopes, before and after any tile loads. So the camera does not move as tiles arrive, and the planner sees the same
  focus on every step.
- The budget is a hard cap on loaded level-1 copies. It is a session option, not a document field
  ([format.md](format.md#not-in-the-document): renderer settings stay out of the document).

### Source (`format/doc.ts`)

A model realizes streamed populations through a `stream` source. Its tiles are a resource of kind `placements`, format
`meso-tiles`. The host supplies the provider that reads that resource (`RuntimeOptions.tiles`), as it supplies `load`
for other resources.

A `Model` has an optional `stream` field, a `StreamSource` whose `resource` names the manifest resource, in the world
frame (or none); the types are in [reference/format.md](reference/format.md#streamsource). The S-expression spelling:

```lisp
(model m.tiles :kind precomputed :method meso.stream
  :populations [p.a p.b]
  :stream (:resource r.tiles))
```

- **A stream model** has `kind: 'precomputed'` and `method: 'meso.stream'`. No resolver of that id exists. `compile`
  never dispatches a model that has `stream`.
- **S-expression:** no codec change. The generic codec writes `stream` as a record (above), and a quick test round-trips
  it.
- **Static validation** (`validate.ts`, phase `static`; codes in `format/issues.ts`):
  - `stream.resource` names a resource (`ref.missing`) of kind `placements` (`ref.kind`) and format `meso-tiles`
    (`value.range`);
  - the model's `kind` is `precomputed` and its `method` is `meso.stream` (`value.range`);
  - the resource's `frame` is absent or the world frame (`stream.unsupported`);
  - the model has no `avoid` and no `refines`, and no model avoids or refines it (`stream.unsupported`): its copies
    would be whatever happens to be loaded;
  - no streamed population's entity has a `superstructure` (`stream.unsupported`);
  - at most one model in the document has `stream` (`stream.unsupported`);
  - its populations count as realized: `model.overlap` applies, `model.unrealized` does not, and no default resolver
    takes them.
- **Issue codes:** the `stream.*` codes are in [reference/issues.md](reference/issues.md#codes).

### Manifest (`format/doc.ts`, the `meso-tiles` format)

The manifest is the format of the tile resource, so its types sit beside the document's. Coordinates are world Å. Tiles
are axis-aligned boxes; this version refuses a stream in a rotated frame rather than transform boxes (above).

The types (`TileManifest`, `TileEntry`, `Box`, `StreamLevel`) are in
[reference/format.md](reference/format.md#tilemanifest). In words: `levels` must hold 0 and 1; `bounds` is the box every
tile lies in; `populations` are exactly the stream model's, in type order; `tiles` come in a fixed order, which the
global ordinals follow (below); a tile has an `id`, a `box`, level-0 `counts` per population and optional `envelopes`.

- **Validation** (`validateManifest(m, model, doc): Issue[]` in `validate.ts`, phase `load`, code `stream.manifest`,
  path `/models/<i>/stream`). It is synchronous and pure, and is called by `compile` once the provider returns the
  manifest:
  - `format` is `meso-tiles`;
  - `levels` holds 0 and 1, only values in {0, 1, 2}, ascending, unique; a 2 gives an `info` issue;
  - `bounds` and every box: six finite numbers, `min < max` on each axis;
  - every tile box lies inside `bounds` (tolerance 10⁻³ Å); tiles may touch; overlap is not checked;
  - `populations`: unique, and the same set as the model's `populations`;
  - at least one tile; tile ids match `IdPattern` and are unique;
  - `counts`: keys in `populations`, values non-negative integers;
  - `envelopes`: keys in `counts`, each box inside its tile's box (same tolerance).
- **An invalid or unavailable manifest** fails the stream model as a failed resolver does: its populations are achieved
  0, the issue says why, and the rest of the scene compiles.
- **Global ordinals.** A copy's ordinal is its index in the tile among its population's copies, plus the sum of that
  population's counts in the tiles before it in manifest order. Copy ids (`<population>#<ordinal>`,
  [ids and keys](ir.md#ids-and-keys)) are therefore unique and stable across loads and evictions.
- **Keys.** `streamKey = <model>@<contentHash({manifest, types})>` (`ir/hash.ts`; `types` is the stream's type table
  below, so an entity radius edit changes it). A tile's set key is `<streamKey>#<tileId>`, its IR ref
  `<model>/stream/<tileId>`. This follows [ids and keys](ir.md#ids-and-keys)'s `<key>#<n>`, with the tile id as `n`.

### Provider contract (`runtime/streaming.ts`)

```ts
// runtime/streaming.ts
export interface TileProvider {
  /** The manifest; the provider memoizes it (compile asks on every model edit). Rejects: `stream.manifest`. */
  manifest(signal?: AbortSignal): Promise<TileManifest>;
  /**
   * A tile's copies at `level` (1 today). Rejects with an `AbortError` once `signal` aborts; a result that arrives
   * after the abort is ignored anyway. Any other rejection, an `AbortError` of the provider's own included (the
   * signal not aborted), and a throw before it returns a promise: `stream.tile`, and the tile is not asked for again
   * until the stream key changes.
   */
  load(tile: string, level: 1, signal: AbortSignal): Promise<TilePayload>;
}

/** A tile's copies, in the placement set's layout (design.md §4.2), world Å; the streamer adds the rest. */
export interface TilePayload {
  readonly count: number;
  /** x y z per copy. */
  readonly positions: Float32Array;
  /** x y z w per copy. */
  readonly rotations: Float32Array;
  /** Index into the manifest's `populations` (= the stream's type table) per copy. */
  readonly types: Int32Array;
}

// runtime/runtime.ts
export interface RuntimeOptions {
  // … as today
  /** The provider of a `meso-tiles` resource, by resource id; undefined: `stream.manifest` (unavailable). */
  readonly tiles?: (resource: Id) => TileProvider | undefined;
}
```

- **The streamer makes the set:**
  `{key, model, frame: 'world', count, positions, rotations, types, ordinals, typeTable}`. It shares the payload's
  buffers (no copy). It allocates `ordinals` and fills them with global ordinals. Every tile shares one `typeTable`
  object, the stream node's `types`, so MesoQL, looks and the adapter work unchanged.
- **A payload is checked before it is kept.** Buffer lengths must match `count`, every type must be in range, and the
  copies per type must equal the tile's manifest `counts`. Otherwise the tile is rejected (`stream.tile`, warning) and
  marked failed. A rejected tile never counts toward the budget.
- **Ownership.** The provider may cache raw data (HTTP, IndexedDB); nothing relies on it. The streamer owns residency: a
  tile is loaded exactly when its set is in the IR. Eviction removes it from the IR, and the adapter deletes its list
  (and store entry) as for any removed set. There is no CPU cache of evicted tiles: a tile seen again is loaded again.
- **Concurrency.** At most `maxInFlight` loads (default 4), started in the plan's order. One `AbortController` per load.
  The streamer aborts a load when the plan cancels it or the stream key changes. Each load carries the stream key and a
  generation number, and a result whose key or generation is stale is dropped.

### Planner and budget (`runtime/streaming.ts`)

`planStream` is pure and deterministic. It reads no clock and no randomness, and its output depends only on its
arguments, never on the order of `manifest.tiles`.

```ts
// runtime/streaming.ts
/** A sphere in world Å: the camera's target and its focus radius (0 for a numeric camera). */
export interface StreamFocus {
  readonly center: readonly [number, number, number];
  readonly radius: number;
}

export interface StreamState {
  /** Resident tiles and their copies. */
  readonly loaded: ReadonlyMap<string, number>;
  /** Tiles being loaded. */
  readonly pending: ReadonlySet<string>;
  /** Tiles that failed or were rejected: never planned again for this stream key. */
  readonly failed: ReadonlySet<string>;
}

export interface StreamBudget {
  /** Hard cap on resident level-1 copies plus copies in flight. */
  readonly copies: number;
  /** Å subtracted from a resident tile's distance (floored at 0), so a tile at the edge does not thrash. Default 0. */
  readonly hysteresis?: number;
}

export interface StreamPlan {
  /** The tiles wanted at level 1, nearest first: resident, pending and new. Their copies total at most the budget. */
  readonly want: readonly string[];
  /** To start loading, nearest first (want minus loaded, pending and failed). */
  readonly request: readonly string[];
  /** Resident tiles to drop now, farthest first. */
  readonly evict: readonly string[];
  /** Pending loads to abort. */
  readonly cancel: readonly string[];
  /** The tiles the focus sphere touches (distance ≤ radius). */
  readonly focus: readonly string[];
  /** Tiles shown at level 0 only once the plan is done: every tile not in `want`, in id order. */
  readonly level0: readonly string[];
  /** Copies of `want`: resident once the requests arrive. */
  readonly copies: number;
  /** A tile that alone exceeds the budget, when one stopped the walk (reported as `stream.budget`). */
  readonly overBudget?: string;
}

export function planStream(
  manifest: TileManifest,
  focus: StreamFocus,
  state: StreamState,
  budget: StreamBudget,
): StreamPlan;
```

The algorithm:

1. **Copies and distance.** `copies(t)` is the sum of the tile's `counts`. `d(t)` is the Euclidean distance from
   `focus.center` to the tile's box (0 inside or on it). For a resident tile, `d'(t) = max(0, d(t) − hysteresis)`;
   otherwise `d' = d`. Failed tiles are left out. A `focus.center` with a non-finite component is read as the bounds'
   centre with radius 0 (a non-finite radius is 0).
2. **Order.** Sort by (not a focus tile, `d'`, id) ascending, a focus tile being one with `d ≤ focus.radius` (step 4),
   so hysteresis never lets a resident tile push one out; ids compare by UTF-16 code units (`a < b`), never
   `localeCompare`.
3. **Walk, nearest first.** Add each tile's copies while the total stays at or under `budget.copies`, and stop at the
   first tile that does not fit. The walk never skips ahead to a smaller tile farther out, so the loaded region stays
   one shell around the focus.
   - A tile with 0 copies is wanted at no cost.
   - If the first tile that does not fit has more copies than the whole budget, it is `overBudget`. The walk stops there
     anyway: the cap is hard, so that tile stays at level 0 and the issue says so.
4. **Focus tiles.** `focus` is every tile with `d ≤ focus.radius`. A focus on a tile boundary has `d = 0` for the tiles
   on both sides, so both sort first and both are wanted when the budget allows. Ties at `d = 0` go by id.
5. **Diff.**
   - `request` is `want` minus resident, pending and failed, in `want` order.
   - `evict` is resident minus `want`, sorted by `(d, id)` descending: farthest first. A focus tile is never evicted
     while a non-focus tile is wanted, because focus tiles come first in the walk.
   - `cancel` is pending minus `want`.
6. **Level 0** needs no work: every tile is at level 0 from compile on, and level 0 never counts toward the budget.

- **Invariant (quick test):** after the session applies a plan, resident copies plus copies in flight are at most
  `budget.copies`. Evictions and cancellations apply in the same step that starts the requests, and `want`'s total is
  within the budget.
- **Budget 0** gives a level-0-only scene: no request.
- **No load radius.** The budget bounds the region. A distance cap and prefetch by camera velocity are not built yet.

### The IR, the session and the adapter

**The `stream` node** (`ir/ir.ts`), a child of the world frame node beside the `resolve` nodes:

```ts
// ir/ir.ts, added to IRNode
  | IRNodeOf<
    'stream',
    {
      readonly model: string;
      readonly resource: string;
      /** `<model>@<hash>`: tile set keys are `<key>#<tileId>`. */
      readonly key: string;
      readonly levels: readonly StreamLevel[];
      readonly bounds: Box;
      /** One per manifest population, in its order; shared by every tile's set. */
      readonly types: readonly PlacementType[];
      /** Level 0: the manifest's tiles (the same objects), with their counts and envelopes. */
      readonly tiles: readonly TileEntry[];
    }
  >
```

- At compile time the node has no children. `ir.streams` and per-model annotations were rejected: the node is the
  smallest thing that already sits in the tree, is walked by `placementSets`, and carries level 0 to any reader.
- **Who reads level 0:** the camera (below), the story's panel (counts by population, tiles), and `irToJson`. `irToJson`
  prints a stream node as `{model, key, levels, bounds, tiles: <n>, copies: <total by population>}`, not every tile. The
  Prism adapter does not draw envelopes yet.
- **`compile`** (`runtime/runtime.ts`). For the stream model it calls `o.tiles?.(resource)?.manifest()` (phase `load`),
  then `validateManifest`, and builds `types` from the normalized populations as `meso.precomputed` builds its type
  table. It emits the node with no resolver run. `counts[p]` is `{requested, achieved}` with `achieved` the manifest
  total: level 0 is the realization. Constraints are not checked for streamed populations: their copies are given.
- **The paired examples** (`examples.test.ts`) leave the tiled fixture out: its IR is level 0 only, and its provider is
  code, not a file.

**Pure helpers** (`runtime/streaming.ts`):

```ts
/** The stream node of an IR (at most one today). */
export function streamNode(ir: IR): Extract<IRNode, { kind: 'stream' }> | undefined;

/**
 * The IR with `sets` as the stream node's `placements` children (refs `<model>/stream/<tileId>`), in manifest order.
 * Every other node keeps its object; the view is unchanged (call `updateView` after).
 */
export function withTiles(ir: IR, sets: ReadonlyMap<string, PlacementSet>): IR;

/** The tile's placement set from a checked payload: global ordinals, the stream's types, the key `<key>#<tile>`. */
export function tileSet(node: Extract<IRNode, { kind: 'stream' }>, tile: TileEntry, p: TilePayload): PlacementSet;

/**
 * The IR as the camera reads it: each stream node's tiles replaced by one proxy set (key `<key>#level0`) with one copy
 * per (population, tile) with a count > 0 (population-major, so a population is one run), at the envelope's centre, identity rotation, and its own type whose radius
 * is the envelope's half-diagonal (population, entity and compartment as the stream's type).
 */
export function level0IR(ir: IR): IR;
```

**The camera reads level 0.** `deriveCamera` (`runtime/runtime.ts`) materializes `focus`, and the scene centre for
`from outside`, over `level0IR(ir)` instead of `ir`. `lociSphere` then gives a sphere that holds the envelopes of the
streamed copies the address picks, together with the non-streamed copies it picks. The sphere is the same whether 0 or
all tiles are loaded. Addresses by ordinal (`(copies p.a 12)`) on a streamed population pick proxy rows, not copies:
this is a limit of this version, and the fixture's tour does not use them. Looks, selection and cutaway still read the
real IR. The camera gets its own materializer and loci cache over `level0IR(ir)`, and calls `lociSphere` with that same
IR: `deriveView`'s materializer is bound to the real IR and caches by address string, so a look and a focus with the
same address (`v.all`'s `(population p.a)`) would otherwise hand the camera real-IR loci that miss in the level-0 IR.
The proxy set is cached per stream node object (a `WeakMap`), since `updateView` runs at least twice an edit.

**The streamer** (`runtime/streaming.ts`) holds the state between steps and calls the provider. It imports nothing of
Mol\*:

```ts
export interface StreamOptions {
  readonly budget: StreamBudget;
  /** Default 4. */
  readonly maxInFlight?: number;
}

export interface StreamStats {
  readonly tiles: number;
  /** Resident now. */
  readonly resident: number;
  readonly inFlight: number;
  /** Cumulative since the stream key last changed; `requested` counts loads started (not plan entries). */
  readonly requested: number;
  readonly loaded: number;
  readonly evicted: number;
  readonly cancelled: number;
  readonly failed: number;
  /** Resident level-1 copies, the budget, and the copies level 0 stands for. */
  readonly copies: number;
  readonly budget: number;
  readonly level0Copies: number;
}

export class TileStreamer {
  constructor(
    tiles: (resource: Id) => TileProvider | undefined,
    options: StreamOptions,
    /** Called when a load settles; the session queues one stream step (coalesced). */
    onSettled: () => void,
  );
  /**
   * One step over a freshly compiled or view-updated IR. It takes in the arrivals still wanted, plans from
   * `ir.view.camera` (center = target, radius = focus radius or 0; no camera: the bounds' centre, radius 0), aborts
   * `cancel`, drops `evict`, starts `request` up to `maxInFlight`, and returns the IR with the resident tiles spliced
   * in (`withTiles`), the plan and issues (`stream.tile`, `stream.budget`; phase `load`). A changed stream key (or no
   * stream node) aborts everything and drops every resident tile first.
   */
  step(ir: IR): { readonly ir: IR; readonly plan?: StreamPlan; readonly issues: readonly Issue[] };
  /** Every issue standing for the stream key: failed tiles, the over-budget tile while it is over. `step` returns the new ones. */
  issues(): readonly Issue[];
  /** The viewer did not take the last step's IR: resident becomes the tiles `drawn` holds, the rest wait as arrivals. */
  restore(drawn: IR | undefined): void;
  stats(): StreamStats;
  dispose(): void;
}
```

**The session** (`molstar/src/session.ts`):

- `MesoSession` takes `stream?: StreamOptions`. When the options have `tiles` and `stream` is set, the session makes a
  `TileStreamer`.
- **Every edit runs the streamer before it commits.** A view edit runs `updateView`; a model edit runs `compile`. Then
  `streamer.step(ir)`, then `updateView(doc, stepped.ir)` (looks for the spliced sets), then `adapter.commit`. After a
  model edit with an unchanged stream key, `step` splices the same set objects back, so `planCommit` keeps them: no full
  rebuild.
- **Issues.** Each step replaces the session's `stream.tile` and `stream.budget` issues with `streamer.issues()`, so a
  model edit keeps a failed-tile warning. A stream step is recorded only when it adds, removes or reports something new.
- **A commit that throws.** The streamer goes back to what the viewer still shows (`restore(this.ir)`): a tile it took
  in that was not drawn is not resident, and the next step takes it in again. An edit's commit failure rejects the edit
  and changes nothing else (as before). A stream step's commit failure is a `render`-phase error issue
  (`adapter.failed`) on the session; nothing rejects, since no caller waits for a settled load.
- **A settled load queues a `stream` step** through the session's existing `queue`, so it never diffs against the same
  previous IR as an edit. Arrivals while a step is queued and not started join that step: one commit per burst. A stream
  step is `step(this.ir)` with the last IR's tile children ignored (the streamer splices its own), then `updateView`,
  then `commit`.
- **`EditRecord`** gains `kind: 'stream'` and
  `stream?: StreamStats & { readonly plan?: { readonly request: number; readonly evict: number; readonly cancel: number } }`.
- **A tour** is a sequence of view edits (`session.view` set to each step's view). Each edit moves the semantic camera
  ([views.md](views.md#the-semantic-camera-camera-tour)), and the step after it requests and evicts. The tour does not
  wait for tiles; arrivals commit as they come.
- **The panel reports**, from the last record and `streamer.stats()`: tiles requested, loaded, evicted, cancelled and
  failed (cumulative); resident tiles and in flight; resident copies against the budget (a bar); level-0 copies.

**The adapter needs nothing new.** `planCommit` sees tile sets as sets. Each stream step adds and removes lists by key,
and keeps the other lists' objects.

- **Known cost [measured]:** `looksChanged` is true whenever a set is added, so each step that adds a tile rewrites
  every list's looks (one `particles.look` call): 4,004 layers at 1,000 lists, 44 at 10. A remove writes none. Up to 100
  lists a remove stays at 5 ms or less and a color edit about 105 ms; at 1,000 they take 163 and 218 ms
  ([design.md](design.md#687-tests-and-the-r5-measurement), R5).

### Fixture (`spec/src/examples/streaming.ts`)

```ts
export interface TiledFixtureOptions {
  /** Tiles per axis; default [4, 4, 2]. */
  readonly grid?: readonly [number, number, number];
  /** Å, default 2000 (200 nm, the yeast viewer's tile). */
  readonly tileSize?: number;
  /** Copies a tile per population; default { 'p.a': 300, 'p.b': 100 }. */
  readonly perTile?: Readonly<Record<string, number>>;
  readonly seed?: number;
  /** For tests: ms before a load resolves (abort tests), and tiles whose load rejects. */
  readonly delayMs?: number;
  readonly fail?: readonly string[];
}

export function tiledFixture(o?: TiledFixtureOptions): {
  readonly doc: MesoViewSpecDoc;
  readonly provider: TileProvider;
};
```

- **The document:**
  - a world frame (right-handed);
  - a box compartment `c.box` over the grid;
  - entities `e.a` (radius 40 Å) and `e.b` (radius 60 Å);
  - populations `p.a` and `p.b` with `count` the grid total;
  - resource `r.tiles` (`placements`, `meso-tiles`), with no `uri`;
  - model `m.tiles` (above);
  - three instances as landmarks: `i.corner` inside the first tile, `i.middle` exactly on the boundary between two
    tiles, `i.far` in the last tile;
  - views: `v.all` (focus `(population p.a)`, `fit`), and `v.corner`, `v.middle` and `v.far` (focus on each landmark,
    `context`);
  - tour `t.stream`: `v.all`, `v.corner`, `v.middle`, `v.far`.
- **The provider** generates everything; there is no file.
  - The manifest is the grid in x, y, z order, with tile id `t.<i>.<j>.<k>` and envelopes equal to the tile box shrunk
    by the population's radius.
  - A tile's copies are uniform in its envelope with random unit quaternions, from `createRandom(subSeed(seed, tileId))`
    (`runtime/random.ts`). They are deterministic, need no overlap test, and are sorted by type.
  - `manifest()` is memoized.
- **Sizes:** the default is 32 tiles and 12,800 copies. The story uses budget 3,000 (7 tiles). The quick tests use
  `grid: [3, 3, 1]` and small counts.

### Not yet, and what it touches

**Not yet:**

- level 2 (atoms at close range);
- prefetch, and priorities by camera velocity or view direction;
- a distance cap or a load radius beyond the budget;
- GPU culling per tile, and a list that grows by appending tiles (R5's recommendation);
- a network protocol or a tile file format: a provider is code, and a `meso-tiles` reader for HTTP comes later;
- more than one stream model, and streams in rotated frames;
- streamed superstructures, and streamed models in `avoid` or `refines`;
- a CPU cache of evicted tiles;
- envelopes drawn in the viewer;
- camera addresses by ordinal on streamed populations.
