import type {
  CardResource,
  FileMetaResource,
  LinkableResource,
  LooseLinkableResource,
  Meta,
} from './resource-types.ts';
import type { CodeRef, ResolvedCodeRef } from './code-ref.ts';
import type { VirtualNetwork } from './virtual-network.ts';
import type { RenderRouteOptions } from './render-route-options.ts';
import type { Definition } from './definitions.ts';
import type {
  ScreenshotFormat,
  ScreenshotImageType,
  ScreenshotManifest,
} from './capture-spec.ts';
import type { ErrorEntry } from './error.ts';
import { rri, type RealmResourceIdentifier } from './realm-identifiers.ts';

import type { RealmEventContent } from '@cardstack/base/matrix-event';
import type { FileDef } from '@cardstack/base/file-api';

export interface LooseSingleResourceDocument<T extends LinkableResource> {
  data: LooseLinkableResource<T>;
  included?: LooseLinkableResource<LinkableResource>[];
}

export interface LooseSingleCardDocument {
  data: LooseLinkableResource<CardResource>;
  included?: LinkableResource[];
}

export interface LooseSingleFileMetaDocument {
  data: LooseLinkableResource<FileMetaResource>;
  included?: LinkableResource[];
}

export type PatchData = {
  attributes?: CardResource['attributes'];
  relationships?: CardResource['relationships'];
  meta?: {
    fields: Meta['fields'];
  };
};

// A broken `linksTo` / `linksToMany` target found on the rendered
// instance, recorded as searchable metadata on the (successful) index
// entry. The card itself indexes as `type='instance'` — the broken slot
// renders a placeholder and the reference is preserved on the wire — so
// this is the only direct, indexed signal that lets a consumer (AI
// tooling, realm-health reports) enumerate cards-with-broken-links
// without parsing the rendered HTML or re-running `getBrokenLinks` at
// read time. `errorDoc` is intentionally omitted: it's large, and the
// error detail is still available at runtime via
// `getRelationshipMembershipState(card, fieldName)` and inline in the rendered placeholder.
export interface BrokenLinkSummary {
  // The declared `linksTo` / `linksToMany` field holding the broken reference.
  fieldName: string;
  // The broken target reference, preserved from the relationship state.
  reference: string;
  // `'error'` for a generic upstream failure, `'not-found'` for an HTTP 404.
  kind: 'error' | 'not-found';
}

// A `searchable` annotation path that didn't resolve against the definition
// graph when the module's definitions were built. Recorded on the module
// render's `meta.diagnostics` and persisted to `modules.diagnostics` so a typo
// / removed field / un-routable segment is visible to authors instead of
// silently making nothing searchable. Definition build is decoupled in time
// from the edit, so these are logged, never thrown; the path is simply not
// followed. Omitted entirely when every annotation in the module resolves.
export interface SearchablePathDiagnostic {
  // The card/field def whose field carried the annotation, as the
  // `internalKeyFor` CodeRef string (a module exports several defs, so the
  // owning def is named to pinpoint the source).
  codeRef: string;
  // The immediate field holding the `searchable` annotation.
  fieldName: string;
  // The dotted `searchable` path that failed to resolve.
  path: string;
}

// A failure to parse a markdown file's leading YAML frontmatter block,
// recorded as a finding on the (still successful) index entry. The file
// indexes fine — `extractAttributes` falls back to treating the whole file
// as body when the frontmatter won't parse — so without this the failure is
// invisible and any frontmatter-declared behavior (e.g. a skill's `commands`)
// silently disappears. Surfaced on `diagnostics.frontmatterParseError` so the
// `/_indexing-errors` surface can flag it the way it flags `brokenLinks`,
// letting authors see and fix the YAML rather than wonder where their
// commands went.
export interface FrontmatterParseError {
  // The YAML parser's error message.
  message: string;
  // 1-based line within the frontmatter block where the parse failed, when
  // the parser reports a position. Omitted otherwise.
  line?: number;
  // 1-based column within that line, when reported.
  column?: number;
}

// Global symbol channel used by file-def `extractAttributes` implementations
// to route a `FrontmatterParseError` back to the host file extractor without
// it leaking into the flat `search_doc`. Producer and consumer must agree on
// the exact string key — exported here so callers share one source of truth
// and a typo can't silently break the handoff.
export const FRONTMATTER_PARSE_ERROR_SYMBOL = Symbol.for(
  'boxel:file-frontmatter-parse-error',
);

// Same symbol-channel pattern for a frontmatter value that must differ
// between the search doc and the file-meta resource: when a
// `FrontmatterField` subclass produces index-only enrichment (e.g. a skill's
// generated tool definitions, which are multi-KB and must never land in
// `search_doc`), `extractAttributes` routes the enriched copy under this key
// and the host file extractor stamps it onto the resource, leaving the
// search doc's `frontmatter` as authored.
export const FRONTMATTER_FILE_META_VALUE_SYMBOL = Symbol.for(
  'boxel:file-frontmatter-file-meta-value',
);

// Same symbol-channel pattern for the `Partial<Diagnostics>` a
// `FrontmatterField` subclass contributes to the indexed row (e.g. a skill's
// `toolSchemaErrors`); the host file extractor lifts it into the extract
// result so the indexer can merge it onto the row's `diagnostics`. Which
// keys the bag carries is the subclass's own knowledge.
export const FRONTMATTER_DIAGNOSTICS_SYMBOL = Symbol.for(
  'boxel:file-frontmatter-diagnostics',
);

// One tool a skill's frontmatter declared whose schema generation failed
// during file extraction — the module wouldn't load, the export was missing,
// or the tool's input-schema generation threw. The skill still indexes
// (instructions plus whichever tools did enrich), so this diagnostics entry
// is the only indexed signal that the tool won't be callable. Surfaced on
// `diagnostics.toolSchemaErrors`, alongside `frontmatterParseError`, via
// `/_indexing-errors`.
export interface ToolSchemaError {
  // The tool's code ref as resolved at extract time (absolute module URL, or
  // the package specifier verbatim when the module isn't realm-hosted).
  module: string;
  name: string;
  message: string;
}

// One performed load of a link target during search-doc production. `path`
// is the dotted field path (from the indexed card's root) of the `linksTo` /
// `linksToMany` field that owns the link; `target` is the resolved
// (absolute) URL that was loaded. A `linksToMany` field produces one entry
// per loaded slot, all sharing the field's `path` and distinguished by
// `target`. A load fired through a field getter — a computed reading a link
// loads via the getter's lazy path, not the generator's targeted loading —
// carries an empty `path`, since the store observing it can't name the
// owning field. Only actual loads are represented — a target already
// resident in the store (or served from the job-scoped document cache)
// records a near-zero entry that the persistence floor drops. Independent
// branches of the walk load concurrently, so entries overlap in time: each
// `ms` is that load's own wall-clock span, and the entries don't sum to the
// walk's elapsed time.
export interface SearchDocLinkLoad {
  path: string;
  target: string;
  ms: number;
}

// Mutable out-param collector `searchDocFromFields` fills in place while it
// walks the card. Each sub-collector is opt-in: the generator only spends
// timer calls on the channels the caller supplies. Values are raw
// (unbounded, unrounded) — the render.meta route prunes to the slowest
// entries before persisting onto `boxel_index.diagnostics`.
export interface SearchDocTimings {
  // Dotted field path → inclusive evaluation wall-clock. A parent field's
  // time includes its nested fields' (and its link loads'), so a slow leaf
  // surfaces alongside every ancestor on its path — the drill-down reads
  // directly from the keys. Plural fields accumulate across their items
  // under one key.
  fieldsMs?: Record<string, number>;
  // One entry per link-target load the walk performed.
  linkLoads?: SearchDocLinkLoad[];
}

// Per-render computed-field counters captured by the host's render.meta
// route. Emitted alongside PrerenderMeta so the Prerenderer can lift them
// onto `response.meta.diagnostics` and the indexer can persist them onto
// `boxel_index.diagnostics`. All fields optional — older host
// builds that predate the counters omit the block entirely.
export interface PrerenderMetaDiagnostics {
  // Number of `computeVia` invocations that ran during the
  // serializeCard + searchDoc traversal for this card. After the
  // pass-scoped memo lands this is one call per distinct computed read
  // per card-instance touched in the pass.
  computedCalls?: number;
  // Number of times the pass memo short-circuited a repeated read of
  // the same computed in the same traversal. `computedCalls +
  // computedCacheHits` is the total computed-read pressure of the
  // pass; the ratio tells you how much duplicate work the memo elided.
  computedCacheHits?: number;
  // Wall-clock of the host-side serializeCard call.
  serializeMs?: number;
  // Wall-clock of the searchable walk that produced the doc — the first
  // walk against a stable load generation. It never waits on getter-fired
  // loads (those mark a walk unstable and it is discarded), but it can
  // include targeted `searchable`-route loads it consumed inline — the
  // first walk to reach a target performs its load, and a first-walk-stable
  // card performs them all here. Each such load is itemized in
  // `searchDocLinkLoads`; because loads run concurrently their entries
  // overlap, so read a load-entry-bearing `searchDocMs` as an upper bound
  // on evaluation time rather than subtracting the entries out.
  searchDocMs?: number;
  // Wall-clock spent driving the card's getter-fired link loads to
  // quiescence before the walk that produced the doc: the discarded walk
  // passes and their load drains. Read `searchDocLinkLoads` for the
  // per-target load breakdown (its entries span both this and the
  // doc-producing walk). Near-zero when the first walk settled.
  searchDocSettleMs?: number;
  // How many walk passes were discarded before one ran against a stable
  // load generation. Each pass loads one more dependency-depth wave, so a
  // high count means a deep searchable/computed link chain (capped
  // host-side; the cap logs a warning). Zero when the first walk settled —
  // the card fired no lazy getter loads.
  searchDocSettlePasses?: number;
  // Per-field inclusive evaluation timings from the timed searchDoc walk,
  // keyed by dotted field path from the indexed card's root (a parent's
  // time includes its children's, so a slow leaf appears alongside its
  // ancestors). Bounded: only the slowest fields at/over a floor are
  // persisted, so a typical ~1 ms search doc records nothing and a slow one
  // records its hot paths — the retained entries' (top-level) sum accounts
  // for `searchDocMs`. A large `searchDocMs` with NO entries means death by
  // a thousand cheap fields rather than one hot path. Omitted when empty.
  searchDocFieldsMs?: Record<string, number>;
  // The slowest searchable link-target loads performed while producing this
  // row's search doc — the settle passes' loads plus any the timed walk
  // still performed — same bounding as `searchDocFieldsMs`. Separates "the
  // linked instance was slow to load" (an entry here) from "the field was
  // expensive to compute" (a hot `searchDocFieldsMs` path with no matching
  // load). Omitted when empty.
  searchDocLinkLoads?: SearchDocLinkLoad[];
  // Broken `linksTo` / `linksToMany` targets found on the rendered
  // instance after the store settled. Captured by the render.meta scan
  // and persisted to `boxel_index.diagnostics.brokenLinks` so
  // cards-with-broken-links are cheaply enumerable. Omitted entirely
  // when the card has no broken links.
  brokenLinks?: BrokenLinkSummary[];
  // Declared-screenshot slots whose capture failed during the
  // prerender-html visit. The row publishes normally — a failed capture is
  // an absent screenshot, not an errored card (the brokenLinks model) — and
  // the manifest simply omits the name, so this is the only indexed signal
  // that a declared capture is missing. Omitted when every slot captured.
  screenshotErrors?: DeclaredScreenshotError[];
  // Wall-clock of the file extract a fused index render performs inside the
  // render.meta route after the card payload is materialized (see
  // FusedIndexMeta). This is the extract's share of the visit's
  // `indexRoutesMs.card.meta` bucket; a standalone render.file-extract
  // transition reports through `indexRoutesMs.file.fileExtract` instead.
  fileExtractMs?: number;
  // Unresolvable `searchable` annotation paths found while building the
  // module's definitions, persisted to `modules.diagnostics`. Populated by the
  // module-prerender route's definition-build validation, not a card render.
  // Omitted entirely when every annotation in the module resolves.
  searchablePathIssues?: SearchablePathDiagnostic[];
}

// Shared type produced by the host app when visiting the render.meta route and
// consumed by the server.
export interface PrerenderMeta {
  serialized: SingleCardDocument | null;
  searchDoc: Record<string, any> | null;
  displayNames: string[] | null;
  deps: string[] | null;
  types: string[] | null;
  // Optional host-side timing block. The Prerenderer lifts this onto
  // `response.meta.diagnostics` so it persists to
  // `boxel_index.diagnostics` for SQL-side perf triage.
  diagnostics?: PrerenderMetaDiagnostics;
}

// A render.meta payload that also carries the file-extract result for the
// same file. Produced when the render options request both `cardRender` and
// `fileExtract`: the meta route materializes the full card payload first,
// then runs the file extract in its own dependency-tracking session, so an
// index visit of a card-instance file pays a single route transition for
// both the instance row and the file row. Drivers split `fileExtract` off
// the capture before treating the remainder as the card payload; hosts that
// don't advertise the `fusedIndexMeta` capability never receive both flags
// and produce a plain PrerenderMeta.
export interface FusedIndexMeta extends PrerenderMeta {
  fileExtract?: FileExtractResponse;
}

// Lightweight payload produced by the host app's render.types route. The
// runner needs the ancestor type list before the fitted/embedded format
// renders run, but those renders are what mark linksTo / linksToMany
// fields as "used"; running a full render.meta (with serializeCard +
// searchDoc) for that early type lookup paid the cost of one extra
// per-card traversal. /types returns just the type chain so the
// runner can drive ancestor renders without that extra walk; a single
// render.meta then runs after the fitted/embedded passes have populated
// the per-instance data bucket and the search doc picks up the linked
// fields the embedded template touched.
export interface PrerenderTypes {
  types: string[] | null;
}

export interface RenderResponse extends PrerenderMeta {
  isolatedHTML: string | null;
  headHTML: string | null;
  atomHTML: string | null;
  embeddedHTML: Record<string, string> | null;
  fittedHTML: Record<string, string> | null;
  iconHTML: string | null;
  markdown: string | null;
  error?: RenderError;
}

// `ErrorEntry` lives in `./error.ts` alongside the `SerializedError` it wraps;
// re-exported here so barrel consumers reach it unchanged.
export type { ErrorEntry } from './error.ts';

// CS-10872: attached to timeout-class RenderErrors so the persisted
// error document tells operators *where* the time went. All fields
// are optional — this is a best-effort diagnostic payload and older
// code paths that don't populate them still work.
export interface RenderTimeoutDiagnostics {
  // Correlation ID threaded from the client-side remote-prerenderer
  // through manager and prerender-server. Paste into a log search to
  // join all three stacks for this call.
  requestId?: string;
  // Worker-job priority of the request that produced this render.
  // Plumbed from the producer side via `Job.priority`, on the tier
  // scale defined in `queue.ts` (system tiers `0`/`1` below the user
  // tiers `9`/`10`). Read in post-mortems and in
  // `prerender-queue-snapshot` triage to tell whether a stalled render
  // was background or user-initiated work.
  priority?: number;
  // Whether this render landed on a tab that was already bound to its
  // affinity. `true` = warm tab, fast launch + cached BrowserContext
  // fetches. `false` = a freshly spawned or commandeered tab — pays
  // the cold-start cost. Triage signal: with `tabReused=true` a slow
  // render is a real render-side stall. With `false` it's a cold start,
  // and `tabProbeMs` says which kind: near-zero means the affinity simply
  // had no warm tab (a cold-start tax — look at `tabStartupMs`), while a
  // multi-second value means there WAS a warm tab and the liveness probe
  // retired it, so this render paid for someone else's wedge.
  tabReused?: boolean;
  // Total wall time spent in `PagePool.getPage` before render work
  // began. The `waits` sub-fields below each cover a specific await;
  // `launchMs` is measured around the full method and so is typically
  // >= their sum — the residual is synchronous bookkeeping (affinity
  // reassignment, LRU touch, standby top-up kickoff) that doesn't fall
  // into any bucket. For triage the sub-field breakdown is what
  // matters: which *await* dominated launch time.
  launchMs?: number;
  waits?: {
    semaphoreMs?: number;
    // Wall time spent waiting on the per-affinity file-admission
    // semaphore in PagePool (capacity = max(1, affinity tab max − 1);
    // when affinity tab max ≥ 2 this leaves at least one tab reserved
    // for module/command work). `admissionMs` ≈ `launchMs` means this
    // realm hit its own file-admission cap; `semaphoreMs` ≈ `launchMs`
    // means the whole server is saturated.
    admissionMs?: number;
    tabQueueMs?: number;
    tabStartupMs?: number;
    // Wall time spent probing warm tabs for main-thread liveness before
    // reuse. Around a millisecond on a healthy tab; a multi-second value
    // means a tab failed the probe and was retired, so this render paid
    // the probe budget plus a replacement tab instead of stalling on a
    // wedged one. Reported apart from `tabQueueMs` so a retired-tab swap
    // isn't read as warm-tab serialization.
    tabProbeMs?: number;
  };
  // Elapsed between render start and the timeout. If ~= timeoutMs the
  // render itself stalled; if << timeoutMs the launch dominated.
  renderElapsedMs?: number;
  // Sum of launch + render elapsed (server-observed).
  totalElapsedMs?: number;
  // Screenshot-capture renders only: the components of `renderElapsedMs`,
  // measured inside `captureScreenshot`. Navigation (route transition +
  // path settle), the prerender settle wait, the image/font paint wait, and
  // the capture loop — the lone `page.screenshot` for a singular capture, or
  // each entry's viewport switch + screenshot for a batch. Their sum is
  // slightly under `renderElapsedMs`; the residual is the terminal-error
  // probe and dimension reads.
  screenshotNavMs?: number;
  screenshotSettleMs?: number;
  screenshotImagePaintMs?: number;
  screenshotCaptureMs?: number;
  // Per-format wall-clock of the html-route renders in this visit, split by
  // the card rendering and the FileDef file rendering. Keys are the format
  // steps the visit ran (`isolated`, `head`, `atom`, `markdown`, and the
  // ancestor-driven `fitted` / `embedded`, each one number covering the
  // whole ancestor chain). Only populated by visits that run html steps, so
  // it tells you which format dominated `renderElapsedMs` — e.g. a slow
  // isolated template vs. a fitted render fanning out across many ancestors.
  renderFormatsMs?: {
    card?: Record<string, number>;
    file?: Record<string, number>;
  };
  // Per-route wall-clock of the index-visit route steps in this visit, split
  // by the card indexing and the FileDef file indexing — the index-half
  // sibling of `renderFormatsMs`. Keys are the route steps an index visit
  // runs: `meta` and `icon` for a card, `fileExtract` and `icon` for a file.
  // The `meta` number covers the whole `render.meta` route, so the
  // types / displayNames chain that route builds is inside that bucket, not a
  // step of its own — the standalone `types` route is html-half work driving
  // the fitted/embedded renders, and never runs on an index visit. On a
  // card-instance index visit against a fused-capable host, `meta` is the
  // consolidated transition and also contains the file extract (its share is
  // itemized as `diagnostics.fileExtractMs`), so `fileExtract` is absent;
  // `fileExtract` appears where a standalone render.file-extract transition
  // ran — non-card files, the fallback extract after a card render error, and
  // a prerender-html visit that resolves its own file resource. Only
  // populated where the index-half step actually runs, so it decomposes the
  // per-visit floor into measured route buckets rather than leaving it
  // inferred from `renderElapsedMs`: on an index visit it rides
  // `boxel_index.diagnostics`.
  indexRoutesMs?: {
    card?: Record<string, number>;
    file?: Record<string, number>;
  };
  // Render-phase breadcrumb set by the host app as it progresses. If
  // missing, we never reached the host route (stalled in launch/fetch).
  renderStage?: string;
  // Ms since `renderStage` was last set. Large values with empty
  // in-flight arrays are the signature of a synchronous stall
  // (e.g. Glimmer compile during module evaluation).
  stageAgeMs?: number;
  // URL lists of host-side docs that were still in flight at timeout.
  cardDocsInFlight?: string[];
  fileMetaDocsInFlight?: string[];
  // Per-URL `ageMs` for the same loads, so operators can tell which
  // single URL has been hanging the longest vs. a fan-out of many.
  cardDocLoadsInFlight?: Array<{ url: string; ageMs: number }>;
  fileMetaDocLoadsInFlight?: Array<{ url: string; ageMs: number }>;
  // Bounded top-N histories of slow *completed* loads. The store
  // keeps these across the whole attempt so the post-timeout
  // diagnostic can still see which card docs / file metas / queries
  // dominated wall time even if they completed just before the
  // timer fired.
  recentCardDocLoads?: Array<{ url: string; ms: number }>;
  recentFileMetaLoads?: Array<{ url: string; ms: number }>;
  recentQueryLoads?: Array<Record<string, unknown>>;
  // Module URLs that the Loader had started fetching but not yet
  // resolved. Each URL is a `.gts` / `.ts` cache miss in flight.
  inFlightModuleImports?: string[];
  // Module URL whose synchronous body (Glimmer compile, side-effect
  // initialisation) is currently running when the diagnostic read
  // happened. Null if evaluate isn't re-entered at the moment.
  currentlyEvaluatingModule?: string | null;
  // Top-N slowest module evaluations observed so far on this page
  // (a rolling window maintained by the Loader). Useful when the
  // stall is "many cheap compiles" rather than one slow one.
  recentModuleEvaluations?: Array<{ url: string; ms: number }>;
  // Legacy counter (kept for back-compat when the older host build
  // only exposes `__docsInFlight()`).
  docsInFlight?: number;
  // DOM snapshot from the page at timeout (prefix of outerHTML).
  capturedDom?: string | null;
  // Stack-ish summary from the blocked-timer shim.
  blockedTimerSummary?: string | null;
  // Outstanding SearchResource / query-field loads at timeout. The
  // shape mirrors QueryLoadInfo from `base/card-api.gts` but is
  // kept loose here to avoid a runtime/base circular type import.
  queryLoadsInFlight?: Array<Record<string, unknown>>;
  // Prerender-server view of the same affinity observed during the
  // call. `pendingTotal` / `maxPending` / `sameAffinityActivity`
  // represent the **peak** observed while the call was in flight —
  // the Prerenderer samples periodically and keeps the richest
  // snapshot, because the most interesting state (queued siblings
  // mid-stall) is released the moment the stuck tab is evicted, so
  // a one-shot end-of-call snapshot would miss the deadlock.
  // `affinityKey` is stable for the call. A non-empty
  // `sameAffinityActivity` on a render stuck in `waiting-stability`
  // is the signature of a self-referential prerender deadlock: the
  // host is waiting on a `/_search` / definition-lookup response
  // that's waiting on a sub-prerender queued behind this very call.
  // Populated server-side, so it's available on both timed-out and
  // slow-but-succeeded rows.
  affinitySnapshot?: {
    affinityKey: string;
    tabCount: number;
    pendingTotal: number;
    maxPending: number;
    sameAffinityActivity: Array<{
      url: string;
      kind: 'visit' | 'module';
      // Which PagePool queue this call is on. On a deadlock fingerprint
      // you'll see `queue: 'module', state: 'queued'` entries waiting
      // on the admission-semaphore-protected file queue.
      queue?: PrerenderQueue;
      state: 'queued' | 'running';
      ageMs: number;
      // Worker-job priority of the call that produced this entry.
      // Surfaced so post-mortems can see what priorities were competing
      // — e.g. a priority-10 file render stuck behind a priority-0
      // module call sticks out cleanly. Optional in the schema even
      // though fresh producers always emit a value: the same shape is
      // deserialized from `boxel_index.diagnostics`, where rows
      // persisted before priority threading landed will lack the
      // field. Consumers should treat absent as `0`.
      priority?: number;
    }>;
  };
  // Host-emitted computed-field counters lifted out of
  // PrerenderMeta.diagnostics so they ride alongside the existing
  // server-observed timings in `boxel_index.diagnostics`.
  computedCalls?: number;
  computedCacheHits?: number;
  serializeMs?: number;
  searchDocMs?: number;
  // The following four are captured server-side on the timeout path
  // only (the in-page hooks above can come back empty when the render's
  // JS thread is wedged). Together they discriminate the render-hang
  // failure mode: an unresponsive main thread with `scriptBusyFraction`
  // near 1 is a CPU-spinning render (runaway loop / never-settling
  // Glimmer, possibly starved by co-tenant renders — see
  // `concurrentRenders`); a responsive main thread with a low script
  // fraction is a render *waiting* on something, in which case
  // `pendingNetworkRequests` names the fetch it never got back.
  //
  // Whether a probe `page.evaluate` could even round-trip within a
  // short budget. `false` means the page's JS thread is wedged (it
  // couldn't run a trivial expression), which is the signature of a
  // CPU-bound stall as opposed to a waiting one.
  mainThreadResponsive?: boolean;
  // Fraction of wall-clock the renderer's main thread spent running JS
  // (CDP `Performance` ScriptDuration delta / wall delta) over a short
  // sampling window at timeout. ~1.0 means the thread is pegged
  // executing JavaScript — a runaway sync loop or a render that never
  // settles. Near 0 means the thread is idle-waiting.
  scriptBusyFraction?: number;
  // Fraction of wall-clock spent in any main-thread task (CDP
  // `Performance` TaskDuration delta / wall delta) — a superset of
  // `scriptBusyFraction` that also counts layout / style / GC. High
  // task but low script points at non-JS main-thread work.
  taskBusyFraction?: number;
  // Renderer JS heap in use at timeout (CDP `Performance`
  // JSHeapUsedSize, bytes → MB). A climbing heap alongside a pegged
  // thread suggests an allocation-heavy runaway rather than a tight
  // CPU loop.
  jsHeapUsedMB?: number;
  // Requests the browser process still had outstanding at timeout,
  // observed out-of-band via CDP `Network` so they survive a wedged
  // JS thread. Oldest first; capped. The longest-lived entry is the
  // resource a *waiting* render is hung on.
  pendingNetworkRequests?: Array<{ url: string; ageMs: number }>;
  // How many renders this prerender process was running concurrently
  // when the timeout fired (every render passes through the same
  // server-side timeout wrapper, which keeps the count). A high value
  // alongside an unresponsive thread points at CPU starvation by
  // co-tenant renders rather than a single render's own runaway.
  concurrentRenders?: number;
}

export interface RenderError extends ErrorEntry {
  evict?: boolean;
  // Transient carrier for host-side diagnostics (render stage,
  // in-flight loads, blocked-timer summary, etc.) produced by
  // `withTimeout`. The Prerenderer lifts these onto
  // `response.meta.diagnostics` before returning, where the indexer
  // picks them up and persists them into `diagnostics`. The
  // field is dropped from the final response — callers should read
  // `response.meta.diagnostics` instead.
  diagnostics?: RenderTimeoutDiagnostics;
}

export interface FileExtractResponse {
  id: string;
  nonce: string;
  status: 'ready' | 'error';
  searchDoc: Record<string, any> | null;
  resource?: FileMetaResource | null;
  types?: string[] | null;
  // Display names walked from the resolved FileDef subclass up its prototype
  // chain (e.g. `['Markdown', 'File']`). Persisted as `boxel_index.display_names`
  // so CardsGrid's "All Files" sidebar can label each subtype.
  displayNames?: string[] | null;
  deps: string[];
  error?: RenderError;
  mismatch?: true;
  // Set when the file's leading YAML frontmatter block was present but
  // wouldn't parse. The extract still succeeds (`status: 'ready'`, body-only);
  // the file indexer merges this onto `diagnostics.frontmatterParseError` so
  // the failure surfaces via `/_indexing-errors` instead of vanishing.
  frontmatterParseError?: FrontmatterParseError;
  // Diagnostics findings the file's frontmatter contributed during the
  // extract (e.g. a skill's `toolSchemaErrors`). The extract still succeeds;
  // the file indexer merges the bag onto the row's `diagnostics` so each
  // finding surfaces via `/_indexing-errors`. Which keys the bag carries is
  // the producing `FrontmatterField` subclass's own knowledge.
  frontmatterDiagnostics?: Partial<Diagnostics>;
}

export interface FileRenderResponse {
  isolatedHTML: string | null;
  headHTML: string | null;
  atomHTML: string | null;
  embeddedHTML: Record<string, string> | null;
  fittedHTML: Record<string, string> | null;
  iconHTML: string | null;
  markdown: string | null;
  error?: RenderError;
}

export type FileRenderArgs = ModulePrerenderArgs & {
  fileData: {
    resource: FileMetaResource;
    fileDefCodeRef: ResolvedCodeRef;
  };
  types: string[];
};

export interface ModuleDefinitionResult {
  type: 'definition';
  moduleURL: string; // node resolution w/o extension
  definition: Definition;
  types: string[];
}

export interface ModulePrerenderModel {
  id: string;
  status: 'ready' | 'error';
  nonce: string;
  isShimmed: boolean;
  lastModified: number;
  createdAt: number;
  deps: string[];
  definitions: Record<string, ModuleDefinitionResult | ErrorEntry>;
  // Every export name of the module, not just the card/field definitions
  // that `definitions` records. Lets callers validate a codeRef whose export
  // is not a BaseDef (e.g. a skill command class) without importing the
  // module themselves. Absent on error responses and on responses from hosts
  // that predate this field.
  exports?: string[];
  error?: ErrorEntry;
}

export interface ModuleRenderResponse extends ModulePrerenderModel {
  // Server-observed timing breakdown, carried in the response body
  // so the indexer can persist it onto `boxel_index.diagnostics`
  // for both in-process and remote prerender paths without needing a
  // separate side channel.
  meta?: PrerenderResponseMeta;
}

export interface PrerenderResponseMeta {
  // Aggregated diagnostic payload — server-observed timings
  // (launchMs, waits, renderElapsedMs, totalElapsedMs from
  // `RenderTimeoutDiagnostics`) plus the host-side `render.meta` block
  // (`PrerenderMetaDiagnostics`: computed-field counters and the
  // `brokenLinks` findings) lifted off the card sub-response. Typed as
  // the full persisted `Diagnostics` shape so consumers of the response
  // contract can read every lifted field — notably `brokenLinks` —
  // without casts; the write-side stamps it adds (`invalidationId`,
  // `indexedAt`) are simply absent at this stage. Populated by the
  // Prerenderer from its own timing measurements and any lifted
  // `RenderError.diagnostics`; the indexer merges in the HTTP `requestId`
  // and persists the result into the `diagnostics` column.
  diagnostics?: Diagnostics;
  // HTTP correlation ID stamped by the prerender server's Koa layer.
  // Lets operators join client → manager → prerender-server logs for
  // a single request. Absent for in-process (non-HTTP) callers.
  requestId?: string;
}

// Per-visit client-side overhead the indexer spent producing a row, measured
// outside the server-observed render timings (`totalElapsedMs` /
// `renderElapsedMs`). The index job runs its file visits serially, so this
// overhead serializes with the render and is otherwise invisible next to it;
// summed across a job's rows it accounts for most of the wall the job spends
// between server renders. The once-per-job phases (discovery, dependency
// ordering, module pre-warm, the final swap) and the aggregate row-write time
// are not attributable to a single row and live on the job result's
// `phaseTimings` (`jobs.result.phaseTimings`) instead.
export interface IndexVisitClientTimings {
  // Wall before the render request: reading the file bytes and the
  // file-metadata lookups (created-at, content hash/size).
  read?: number;
  // Render round-trip transport: the client-observed wall of the prerender
  // visit(s) minus the server-observed `totalElapsedMs` — the request/response
  // plumbing between the indexer and the prerender server (serialization,
  // network/IPC, waits not counted server-side). ~0 for the in-process (fused
  // / in-browser) prerenderer, where there is no wire hop.
  renderRpc?: number;
  // Post-render bookkeeping: dependency resolution and index-entry construction
  // between the render completing and the row write. Excludes the write itself
  // (a row cannot time its own INSERT); the job's aggregate write time lives on
  // the job result's `phaseTimings.writeMs` (`jobs.result.phaseTimings.writeMs`).
  bookkeeping?: number;
}

// The shape persisted to the `diagnostics` columns — `boxel_index` for the
// index visit's breakdown, `prerendered_html` for the prerender-html visit's
// (the two visits' costs are independently queryable per row; join them on
// url). Named `Diagnostics` (not `TimingDiagnostics`) because the block is
// not purely about timing: it also carries `brokenLinks`, the
// broken-link findings the render surfaced. Extends
// `RenderTimeoutDiagnostics` (which already carries `requestId`) with two
// write-side stamps applied at `IndexWriter.updateEntry` time:
//
//   - `invalidationId` — one UUID per `Batch`; every row touched by
//     the same indexing pass (incremental fan-out or fromScratch)
//     shares it, so operators can `SELECT ... WHERE
//     diagnostics->>'invalidationId' = '<id>'` and see the
//     whole batch.
//   - `indexedAt` — wall-clock the write happened.
//
// All fields are optional because writers populate incrementally:
// render-side fields come from the Prerenderer's response meta, the
// write-side stamps come from the IndexWriter. Any stage may skip
// pieces that aren't applicable (e.g. non-timeout renders have no
// `renderStage`, in-process callers have no `requestId`).
// Extends both render-side diagnostic shapes so the persisted blob types
// every field that actually lands in it: server-observed timings from
// `RenderTimeoutDiagnostics` and the host-side `render.meta` block from
// `PrerenderMetaDiagnostics` (computed-field counters plus `brokenLinks`).
// The two write-side stamps below are added at `IndexWriter.updateEntry`.
export interface Diagnostics
  extends RenderTimeoutDiagnostics, PrerenderMetaDiagnostics {
  invalidationId?: string;
  indexedAt?: number;
  // Host-shell token the prerender server had been told was current when this
  // render started, and again when its response was assembled. Two different
  // values mean the render straddled a host redeploy: the page resolved
  // modules against a bundle the realm server may already have stopped
  // serving. Unremarkable for a render that succeeded, and decisive for one
  // that failed to resolve a module — that failure then describes the
  // environment rather than the card, which is what an operator reading the
  // error row needs to know. Lives here rather than on the response meta
  // because `flattenPrerenderMeta` carries `diagnostics` onto the persisted
  // row and drops every other meta key.
  hostShellHash?: string;
  hostShellHashAtCompletion?: string;
  // A row is produced by two prerender visits (index + prerender-html),
  // each its own HTTP request. `requestId` always carries the index visit's
  // id and this always carries the prerender-html visit's, whichever table
  // the blob lands in. A split-pipeline write puts `requestId` on
  // `boxel_index.diagnostics` and this field on
  // `prerendered_html.diagnostics`; a fused pass produces one combined blob
  // — both ids, when each visit was its own HTTP request — which lands on
  // `boxel_index` and is projected as-is onto `prerendered_html`. Absent
  // for in-process callers.
  prerenderHtmlRequestId?: string;
  // Frontmatter YAML that wouldn't parse during file extraction. The row
  // still indexes (body-only); this is the only indexed signal that the
  // file's frontmatter — and anything it declared — was dropped. Merged in
  // by the file indexer from the extract response. Absent when the
  // frontmatter parsed (or there was none).
  frontmatterParseError?: FrontmatterParseError;
  // Skill frontmatter tools whose index-time schema generation failed. The
  // row still indexes (instructions plus the tools that did enrich); this is
  // the only indexed signal that a declared tool won't be callable. Merged
  // in by the file indexer from the extract response. Absent when every
  // declared tool enriched (or the file declared none).
  toolSchemaErrors?: ToolSchemaError[];
  // Per-visit client-side overhead of producing this row (file read, render
  // round-trip transport, post-render bookkeeping) — the index-job wall spent
  // on this row outside the server render. See `IndexVisitClientTimings`.
  // Omitted when nothing was measured (e.g. a resumed row promoted without a
  // fresh visit).
  indexVisitClientMs?: IndexVisitClientTimings;
}

// Flatten a prerender `response.meta` block into the shape persisted to
// `*.diagnostics` columns. Keeps the rich host-side payload (from
// `meta.diagnostics`) at the top level and promotes the HTTP `requestId`
// alongside it for jsonb-path querying. Returns `undefined` when there's
// nothing to persist. Used by both the indexer (boxel_index rows) and the
// definition-lookup module-cache writer (modules rows).
export function flattenPrerenderMeta(
  meta: PrerenderResponseMeta | undefined,
): Diagnostics | undefined {
  if (!meta) return undefined;
  let diagnostics = meta.diagnostics ?? {};
  let hasRequestId = meta.requestId != null;
  let hasAny = Object.keys(diagnostics).length > 0 || hasRequestId;
  if (!hasAny) return undefined;
  return {
    ...diagnostics,
    ...(hasRequestId ? { requestId: meta.requestId } : {}),
  };
}

// The prerender-html-visit flavor of `flattenPrerenderMeta`, for blobs bound
// for `prerendered_html.diagnostics`: the visit's HTTP correlation id lands
// under `prerenderHtmlRequestId` rather than `requestId`, keeping the
// field-name → visit mapping constant across both diagnostics columns
// (`requestId` always names an index visit, `prerenderHtmlRequestId` always
// names a prerender-html visit).
export function flattenPrerenderHtmlVisitMeta(
  meta: PrerenderResponseMeta | undefined,
): Diagnostics | undefined {
  let flattened = flattenPrerenderMeta(meta);
  if (!flattened) return undefined;
  let { requestId, ...rest } = flattened;
  return {
    ...rest,
    ...(requestId != null ? { prerenderHtmlRequestId: requestId } : {}),
  };
}

export type AffinityType = 'realm' | 'user';

// Routing dimension orthogonal to `AffinityType`. Inside one
// realm affinity, calls are split into two queues (`file` for card
// renders via `prerenderVisit`, `module` for definition extractions
// via `prerenderModule`) so a file render blocked on a module can't
// starve the module that would unblock it. `command` is the only
// queue on user affinities — `runCommand` uses it and the split is
// a no-op there. Tabs themselves stay generic: any tab can serve
// any queue; the split only governs admission ordering.
export type PrerenderQueue = 'file' | 'module' | 'command';

export type AffinityArgs = {
  affinityType: AffinityType;
  affinityValue: string;
};

export type ModulePrerenderArgs = {
  affinityType: AffinityType;
  affinityValue: string;
  realm: string;
  url: string;
  auth: string;
  renderOptions?: RenderRouteOptions;
  // Worker-job priority threaded through from the producer side.
  // Higher priority requests dequeue ahead of lower-priority pending
  // work on the prerender server (per-tab queues + per-affinity file-
  // admission semaphore + global render semaphore). No preemption: an
  // in-flight low-priority render runs to completion. Defaults to the
  // lowest tier (0) when absent.
  priority?: number;
};

export type PrerenderCardArgs = ModulePrerenderArgs;

// Canonical ordering for the composite "visit" prerender. The server-side
// RenderRunner and the in-browser card-prerender component share this order
// so both code paths exercise passes identically.
export const VISIT_PASS_ORDER = [
  'fileExtract',
  'cardRender',
  'fileRender',
] as const;
export type VisitPass = (typeof VISIT_PASS_ORDER)[number];

// The consolidated visit splits along the search-doc/HTML seam into two
// visit types:
//
//   - 'index' — everything the search index needs: the file extract, the
//     card's meta (search doc / serialized / types / display names / deps)
//     and the icon render. Never runs the `html` route, never materializes
//     a format component via `getComponent`.
//   - 'prerender-html' — the `html` route per format (isolated, head,
//     atom, fitted, embedded) plus markdown, for both the card and the
//     file rendering of a URL. Produces no search-doc data.
//
// A visit with no `visitType` runs the union of both (the fused visit) —
// used by callers that want a complete render in one round-trip (e.g. the
// user-initiated prerender proxy).
export type PrerenderVisitType = 'index' | 'prerender-html';

export type PrerenderVisitArgs = {
  affinityType: AffinityType;
  affinityValue: string;
  realm: string;
  url: string;
  auth: string;
  // Selects which half of the bifurcated visit to run — see
  // PrerenderVisitType. Absent runs the fused union of both halves.
  visitType?: PrerenderVisitType;
  renderOptions?: RenderRouteOptions;
  // Inputs required only when the fileRender pass is requested
  fileData?: FileRenderArgs['fileData'];
  types?: string[];
  // Ancestor type chain (internalKeyFor form) driving the card's
  // fitted/embedded format renders in a 'prerender-html' visit. Supplied
  // by callers that already hold the chain (the indexing job passes the
  // index visit's `types` through); when absent the visit resolves the
  // chain itself via the types route.
  cardTypes?: string[];
  // Identifies the indexing batch this visit belongs to (CS-10758 step 3).
  // Required to honor `renderOptions.clearCache: true` on the prerender
  // server when another batch currently owns the affinity. Visits without
  // a batchId (e.g. user-initiated prerenders, cross-realm traffic) have
  // clearCache stripped whenever an active batch owns the affinity —
  // protecting the indexer's warm loader from being wiped by incidental
  // callers.
  batchId?: string;
  // Worker-job priority threaded through from the producer side. See
  // ModulePrerenderArgs for the contract.
  priority?: number;
  // `<jobId>.<reservationId>` of the indexing job that triggered this
  // visit. Threaded through to manager + prerender-server as
  // `x-boxel-job-id` so all three services tag their logs with
  // `[job: J.R]` — same substring already emitted by worker code,
  // making `{service=~"realm-server|worker|prerender|prerender-manager"}
  // |= "[job: J.R]"` a single reliable filter for "everything that
  // happened during this indexing job."
  jobId?: string;
  // Present when the caller wants the visit to capture the card's declared
  // screenshots (`static screenshots`) on the same warm tab — the
  // prerender-html indexing pass sends this when it has a MediaCache to
  // persist into. Only honored by 'prerender-html' visits.
  screenshots?: DeclaredScreenshotVisitArgs;
};

// Inputs the declared-screenshot capture step needs from the indexing side:
// what the previous pass captured (so unchanged file-content-keyed slots can
// carry forward without re-rendering) and the source file's current
// realm_file_meta content hash to compare against.
export type DeclaredScreenshotVisitArgs = {
  priorManifest?: ScreenshotManifest | null;
  contentHash?: string | null;
};

export type DeclaredScreenshotError = {
  name: string;
  message: string;
};

// One declared slot's outcome from the visit's capture step. A fresh capture
// carries `base64`; a carry-forward (`carriedForward: true`, file-content-
// keyed slot whose source bytes are unchanged) carries no bytes — the caller
// copies the prior manifest entry instead of persisting anything.
export type DeclaredScreenshotCaptureResult = {
  name: string;
  specHash: string;
  // CSS px of the capture box; physical pixels are these × deviceScaleFactor.
  width: number;
  height: number;
  deviceScaleFactor: number;
  contentType: string;
  imageType: ScreenshotImageType;
  keyBy: 'generation' | 'file-content';
  useAsThumbnail?: boolean;
  base64?: string;
  carriedForward?: boolean;
};

export interface DeclaredScreenshotVisitResult {
  entries: DeclaredScreenshotCaptureResult[];
  // Per-slot capture failures — the broken-links model: they never fail the
  // visit, the manifest just omits the name.
  errors?: DeclaredScreenshotError[];
}

// Arguments for releasing an indexing batch's ownership of an affinity,
// called from `IndexRunner`'s `finally` blocks after a run completes.
// Clears the owner entry so the next batch can acquire it without a forced
// successor-replacement.
export type ReleaseBatchArgs = {
  batchId: string;
  affinityType: AffinityType;
  affinityValue: string;
};

// Each sub-field is populated only when the corresponding pass was requested.
// `pageUnusableError` is set ONLY when the page itself died mid-visit and
// remaining passes were short-circuited as a result — e.g. the page was
// evicted or window.onerror fired an unrecoverable error. Auth failures
// (401/403) do NOT set this field; they populate the per-pass `.error`
// instead, because the page is still healthy, just not authorized for the
// current caller.
export interface RenderVisitResponse {
  card?: RenderResponse;
  fileExtract?: FileExtractResponse;
  fileRender?: FileRenderResponse;
  // Declared-screenshot captures, present when the visit args requested them
  // (see PrerenderVisitArgs.screenshots) and the card pass reached the
  // capture step. Absent entirely on prerenderers that don't support
  // capture (the in-browser twin) — the caller writes no manifest then.
  screenshots?: DeclaredScreenshotVisitResult;
  pageUnusableError?: RenderError;
  // See ModuleRenderResponse.meta — server-observed timing breakdown
  // embedded in the response so the indexer can persist it to
  // `boxel_index.diagnostics`.
  meta?: PrerenderResponseMeta;
}

export type RunCommandArgs = {
  userId: string;
  auth: string;
  command: string;
  commandInput?: Record<string, any> | null;
  // Worker-job priority threaded through from the producer side. See
  // ModulePrerenderArgs for the contract.
  priority?: number;
};

export type RunCommandResponse = {
  status: 'ready' | 'error' | 'unusable';
  cardResultString?: string | null;
  error?: string | null;
  // Server-observed timing meta — same channel as the visit /
  // module responses. Unused by most callers (command results
  // aren't persisted to `boxel_index`), but attached uniformly so
  // `Prerenderer.decorateRenderErrorsWithTimings` can stamp it
  // without a special-case for commands.
  meta?: PrerenderResponseMeta;
};

// The individual capture overrides shared by the singular spec and each batch
// entry. All fields optional and JSON-serializable.
export type ScreenshotCaptureOverrides = {
  // CSS-pixel render viewport applied via `page.setViewport` before the render
  // settles, then restored so pooled pages don't leak the size into later index
  // prerenders.
  viewport?: { width: number; height: number };
  // Puppeteer device scale factor (1 = CSS px, 2 = retina). Multiplies the
  // PNG's physical pixel dimensions without changing the reported CSS dims.
  deviceScaleFactor?: number;
  // Capture the full scrollable document rather than just the viewport. Mutually
  // exclusive with `clip`.
  fullPage?: boolean;
  // CSS-pixel region to capture, passed straight to `page.screenshot`. Its
  // extent is bounded by the same caps as the viewport (and must sit within
  // the viewport when one is given). Mutually exclusive with `fullPage`. A
  // batch entry may set `clip: null` to drop a batch-wide clip default (the
  // only "back to no clip" spelling an object-valued field has); it elides
  // away after the merge, so a normalized spec never carries null.
  clip?: { x: number; y: number; width: number; height: number } | null;
  // CSS selector for a single element to capture — an element-handle
  // screenshot of the first match, tightly cropped to its box. Mutually
  // exclusive with `clip` and `fullPage` (an element screenshot honors
  // neither). The selector is bounded in length; the capture path resolves it
  // with `document.querySelector`, so a non-CSS (e.g. XPath-shaped) string is a
  // named capture error rather than a wrong crop. A batch entry may set
  // `target: null` to drop a batch-wide target default, the same "back to no
  // target" spelling `clip` has; it elides away after the merge.
  target?: string | null;
  // Fixed-size parent box (CSS px) the card renders into. `fitted` fills a
  // parent-owned box rather than the viewport, so it needs this to lay out
  // and fire its `@container fitted-card` queries. Required for fitted
  // captures and refused for isolated/embedded (enforced by the shared
  // capture-spec parse on both request surfaces). The capture is sized to the
  // envelope, so a batch of differing envelopes yields differently-sized PNGs
  // off one render.
  envelope?: { width: number; height: number };
};

// One entry in a batch capture: a name plus the same per-capture overrides. An
// entry's fields override the singular spec fields, which act as batch-wide
// defaults.
export type ScreenshotCaptureEntry = ScreenshotCaptureOverrides & {
  name: string;
};

// Optional per-capture overrides for a screenshot render. All fields are
// JSON-serializable so this rides through the worker queue on
// `ScreenshotCardArgs`. Bounds are enforced by the shared strict parse in
// `capture-spec.ts` before the job is enqueued (both the realm-server POST
// body and the prerender server's screenshot route run it); the capture path
// (`captureScreenshot`) treats these as already-validated but still rejects
// the mutually-exclusive `fullPage` + `clip` combination defensively and
// bounds a fullPage capture's document extent, which no parse can know.
//
// When `captures` is present the render is captured once per entry (after a
// single settle); each entry's overrides win over the singular fields. When it
// is absent the singular fields describe a single capture.
export type ScreenshotCaptureSpec = ScreenshotCaptureOverrides & {
  captures?: ScreenshotCaptureEntry[];
};

// ScreenshotFormat is defined (with its runtime const + guard) in
// `capture-spec.ts`, re-exported from this module, and imported at the top of
// this file for the types below.

export type ScreenshotPrerenderArgs = {
  realm: string;
  url: string;
  auth: string;
  format: ScreenshotFormat;
  // Optional per-capture overrides (viewport, scale, fullPage, clip).
  captureSpec?: ScreenshotCaptureSpec;
  // Worker-job priority threaded through from the producer side. See
  // ModulePrerenderArgs for the contract.
  priority?: number;
  // Worker-job identity (`jobId.reservationId`), forwarded by the remote
  // prerenderer as the `x-boxel-job-id` header so manager and
  // prerender-server logs for this render join back to the worker job.
  // Ignored by in-process prerenderers.
  jobId?: string;
};

// One captured image in a screenshot response. `deviceScaleFactor` is the
// effective scale used for this capture, so a consumer can reconstruct physical
// vs CSS pixel dimensions.
export type ScreenshotCaptureResult = {
  name: string;
  base64: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
};

export type ScreenshotPrerenderResponse = {
  status: 'ready' | 'error' | 'unusable';
  // Present on every ready response (a single entry named "default" when the
  // request used the singular fields); error and unusable responses carry
  // none. The top-level `base64`/`width`/`height` mirror `captures[0]` for
  // back-compat with the shipped host tool and the staging capture command,
  // which read the singular fields.
  captures?: ScreenshotCaptureResult[];
  base64?: string;
  width?: number;
  height?: number;
  contentType?: 'image/png';
  error?: string | null;
  meta?: PrerenderResponseMeta;
};

export interface Prerenderer {
  prerenderModule(args: ModulePrerenderArgs): Promise<ModuleRenderResponse>;
  prerenderVisit(args: PrerenderVisitArgs): Promise<RenderVisitResponse>;
  runCommand(args: RunCommandArgs): Promise<RunCommandResponse>;
  // Optional: supported by server-side prerenderers that implement
  // `clearCache` batch ownership (CS-10758 step 3). Callers should probe
  // before invoking since not every Prerenderer implementation participates
  // in ownership tracking (e.g. test stubs, remote variants on older servers).
  releaseBatch?(args: ReleaseBatchArgs): Promise<void>;
  // Optional: capture a settled card render to a PNG. Optional so test
  // stubs and older Prerenderer implementations are not forced to
  // implement it; the screenshot-card worker task
  // (`runtime-common/tasks/screenshot-card.ts`) probes for this method at
  // runtime and surfaces a useful error if the configured prerenderer
  // doesn't support it.
  prerenderScreenshot?(
    args: ScreenshotPrerenderArgs,
  ): Promise<ScreenshotPrerenderResponse>;
}

export type RealmAction = 'read' | 'write' | 'realm-owner' | 'assume-user';

export interface RealmPermissions {
  [username: string]: RealmAction[];
}

export { Deferred } from './deferred.ts';
export {
  CardError,
  isCardError,
  formattedError,
  type SerializedError,
  type CardErrorJSONAPI,
  type CardErrorsJSONAPI,
  isCardErrorJSONAPI,
  clampSerializedError,
  coerceErrorMessage,
  stringifyErrorForLog,
  sanitizeForJsonb,
  mergeErrorDetail,
  mergeErrorsByGeneration,
  ERROR_DOC_MAX_BYTES,
  ERROR_DOC_MAX_ADDITIONAL_ERRORS,
} from './error.ts';
export {
  fileSizeLimitFor,
  validateByteLength,
  validateWriteSize,
} from './write-size-validation.ts';
export {
  computeContentHash,
  isSampledContentHash,
  CONTENT_HASH_WHOLE_LIMIT_BYTES,
  CONTENT_HASH_HEAD_BYTES,
  CONTENT_HASH_TAIL_BYTES,
} from './content-hash.ts';
export type { FileSizeLimits } from './write-size-validation.ts';

export interface ResourceObject {
  type: string;
  attributes?: Record<string, any>;
  relationships?: Record<string, any>;
  meta?: Record<string, any>;
}

export interface ResourceObjectWithId extends ResourceObject {
  id: string;
}

export interface DirectoryEntryRelationship {
  links: {
    related: string;
  };
  meta: FileMeta | DirectoryMeta;
}

export interface FileMeta {
  kind: 'file';
  lastModified: number | null;
  resourceCreatedAt?: number;
}

export interface DirectoryMeta {
  kind: 'directory';
}

export interface RealmCards {
  url: string | null;
  realmInfo: RealmInfo;
  cards: CardDef[];
}

// TODO should we use the secure form once we start letting lid's drive the id
// on the server? address in CS-8343
export { v4 as uuidv4 } from '@lukeed/uuid'; // isomorphic UUID's using Math.random
import type { LocalPath } from './paths.ts';
import type { CardTypeFilter, Query, EveryFilter } from './query.ts';
import { Loader } from './loader.ts';
export * from './frontmatter-parse.ts';
export * from './http-range.ts';
export * from './paths.ts';
export * from './directory-view-refresher.ts';
export * from './realm-client.ts';
export * from './realm-operations.ts';
export * from './published-realm-url.ts';
export * from './realm-index-card.ts';
export * from './cached-fetch.ts';
export * from './definition-lookup.ts';
export * from './definitions.ts';
export * from './query-canonicalization.ts';
export * from './searchable-routes.ts';
export * from './catalog.ts';
export * from './commands.ts';
export * from './realm-identifiers.ts';
export * from './bfm-card-references.ts';
export * from './bfm-math-render.ts';
export * from './bfm-mermaid-render.ts';
export * from './constants.ts';
export * from './search-replace-markers.ts';
export * from './helpers/const.ts';
export * from './document.ts';
export * from './matrix-constants.ts';
export * from './session-token.ts';
export * from './matrix-client.ts';
export * from './queue.ts';
export * from './job-utils.ts';
export * from './prerender-html-reconcile.ts';
export * from './media-cache.ts';
export * from './media-cache-serving.ts';
export * from './screenshot-perf.ts';
export * from './capture-spec.ts';
export * from './expression.ts';
export * from './searchable-parity.ts';
export * from './infer-content-type.ts';
export * from './index-query-engine.ts';
export * from './index-writer.ts';
export * from './definitions.ts';
export * from './index-structure.ts';
export * from './db.ts';
export * from './tasks/index.ts';
export * from './worker.ts';
export * from './stream.ts';
export * from './realm.ts';
export * from './realm-index-updater.ts';
export * from './fetcher.ts';
export * from './test-waiters.ts';
export * from './scoped-css.ts';
export * from './html-utils.ts';
export * from './utils.ts';
export * from './authorization-middleware.ts';
export * from './resource-types.ts';
export * from './prerender-headers.ts';
export * from './query.ts';
export * from './query-signature.ts';
export * from './instance-filter-matcher.ts';
export * from './search-utils.ts';
export * from './search-resource-helpers.ts';
export * from './search-entry.ts';
export * from './search-bounds.ts';
export * from './request-timings.ts';
export * from './prerendered-html-format.ts';
export * from './query-field-utils.ts';
export * from './relationship-utils.ts';
export * from './formats.ts';
export * from './dependency-tracker.ts';
export * from './github-submissions.ts';
export { getCreatedTime } from './file-meta.ts';
export { mergeRelationships } from './merge-relationships.ts';
export { makeLogDefinitions, logger, reapplyLogLevels } from './log.ts';
export { Loader };
export {
  fetchWithTransientRetry,
  isRetryableStatus,
  DEFAULT_TRANSIENT_RETRY_DELAYS_MS,
} from './loader.ts';
export {
  cardTypeDisplayName,
  cardTypeIcon,
  getFieldIcon,
} from './helpers/card-type-display-name.ts';
export * from './helpers/ensure-extension.ts';
export {
  sanitizeHeadHTML,
  sanitizeHeadHTMLToString,
  findDisallowedHeadTags,
} from './helpers/sanitize-head-html.ts';
export * from './url.ts';
export * from './render-route-options.ts';
export * from './publishability.ts';
export * from './pr-manifest.ts';
export * from './file-def-code-ref.ts';

export const executableExtensions = ['.js', '.gjs', '.ts', '.gts'];
// Extensions covered by the realm-wide pre-warm sweep that primes the
// modules cache before the visit loop. This is an optimization, not a
// correctness gate: a `.ts` / `.js` file CAN host a `CardDef`
// (e.g. command-input cards), and if pre-warm misses one the on-demand
// `lookupDefinition` cache read-through fires a `prerenderModule` for
// it during the visit. The PagePool's tab-materialization for
// module/command callers makes that on-demand path safe (the sub-
// prerender gets its own tab instead of queueing behind the render
// that triggered it). Restricting the sweep to `.gts` / `.gjs` — where
// cards live almost exclusively in practice — avoids paying the
// prerender cost on every index for a file type that rarely contains
// card definitions.
export const cardExtensions = ['.gts', '.gjs'];
export { createResponse } from './create-response.ts';

export * from './db-queries/db-types.ts';
export * from './db-queries/realm-metadata-queries.ts';
export * from './db-queries/realm-permission-queries.ts';
export * from './db-queries/session-room-queries.ts';
export * from './db-queries/user-queries.ts';

// From https://github.com/iliakan/detect-node
export const isNode =
  Object.prototype.toString.call((globalThis as any).process) ===
  '[object process]';

export { SupportedMimeType, isJsonContentType } from './supported-mime-type.ts';
export {
  isUrlLike,
  VirtualNetwork,
  type ResponseWithNodeStream,
} from './virtual-network.ts';
export { RealmAuthDataSource } from './realm-auth-data-source.ts';

export type {
  Kind,
  RealmAdapter,
  FileRef,
  RealmIndexCounts,
  RealmInfo,
  TokenClaims,
  RealmSession,
} from './realm.ts';

export * from './code-ref.ts';
export * from './command-parsing-utils.ts';
export * from './serializers/index.ts';
export * from './host-routing-validation.ts';

export type {
  CardDocument,
  SingleCardDocument,
  SingleFileMetaDocument,
  CardCollectionDocument,
  FileMetaCollectionDocument,
  EntryCollectionDocument,
  EntrySingleDocument,
  EntryIncludedResource,
  SearchEntryResults,
} from './document-types.ts';
export type {
  CardResource,
  FileMetaResource,
  ModuleResource,
  CardResourceMeta,
  ResourceID,
  Meta,
  Saved,
  Relationship,
  CardFields,
  LooseLinkableResource,
} from './resource-types.ts';
export {
  isCardDocument,
  isCardCollectionDocument,
  isSingleCardDocument,
  isSingleFileMetaDocument,
  isFileMetaCollectionDocument,
  isEntryCollectionDocument,
  isEntrySingleDocument,
  isCardDocumentString,
} from './document-types.ts';
export {
  isMeta,
  isCardResource,
  isModuleResource,
  isRelationship,
} from './resource-types.ts';

export type { JWTPayload } from './realm-auth-client.ts';
export { sanitizeHtml } from './dompurify-runtime.ts';

export { getPlural } from './pluralize-runtime.ts';

import type { CardDef, FieldDef, BaseDef } from '@cardstack/base/card-api';
import type * as CardAPI from '@cardstack/base/card-api';
import type { RealmInfo } from './realm.ts';
import type { QueryResultsMeta } from './index-query-engine.ts';

export interface MatrixCardError {
  id?: string;
  error: Error;
}

export function isMatrixCardError(
  maybeError: any,
): maybeError is MatrixCardError {
  return (
    typeof maybeError === 'object' &&
    'error' in maybeError &&
    maybeError.error instanceof Error
  );
}

export type CreateNewCard = (
  ref: CodeRef,
  relativeTo: RealmResourceIdentifier | URL | undefined,
  opts?: {
    isLinkedCard?: boolean;
    doc?: LooseSingleCardDocument;
    realmURL?: URL;
  },
) => Promise<string | undefined>;

interface CardChooserOpts {
  offerToCreate?: {
    ref: CodeRef;
    relativeTo: RealmResourceIdentifier | URL | undefined;
    realmURL: URL | undefined;
  };
  createNewCard?: CreateNewCard;
  consumingRealm?: URL;
  preselectConsumingRealm?: boolean;
  /**
   * When true, the realm scope is fixed to consumingRealm and the user
   * cannot broaden it via the realm picker. Use for fields that must
   * reference cards within the consuming realm (e.g. RoutingRuleField).
   */
  lockConsumingRealm?: boolean;
  preselectedCardUrls?: string[];
}

export interface CardChooser {
  chooseCard(
    query: CardChooserQuery,
    opts?: CardChooserOpts & { multiSelect?: boolean },
  ): Promise<undefined | string | string[]>;
}

export interface FileChooser {
  chooseFile<T>(opts?: {
    fileType?: CodeRef;
    fileTypeName?: string;
    // Equality constraints on indexed file fields (e.g. `{ kind: 'skill' }`),
    // narrowing the chooser beyond the file type.
    fileFieldFilter?: Record<string, unknown>;
  }): Promise<undefined | T>;
}

export async function chooseCard(
  query: CardChooserQuery,
  opts: CardChooserOpts & {
    multiSelect: true;
    preselectedCardTypeQuery?: Query;
  },
): Promise<undefined | string[]>;
export async function chooseCard(
  query: CardChooserQuery,
  opts?: CardChooserOpts & {
    multiSelect?: false;
    preselectedCardTypeQuery?: Query;
  },
): Promise<undefined | string>;
export async function chooseCard(
  query: CardChooserQuery,
  opts?: CardChooserOpts & {
    multiSelect?: boolean;
    preselectedCardTypeQuery?: Query;
  },
): Promise<undefined | string | string[]> {
  let here = globalThis as any;
  if (!here._CARDSTACK_CARD_CHOOSER) {
    throw new Error(
      `no cardstack card chooser is available in this environment`,
    );
  }
  let chooser: CardChooser = here._CARDSTACK_CARD_CHOOSER;

  return await chooser.chooseCard(query, opts);
}

export async function chooseFile<T extends FileDef>(opts?: {
  fileType?: CodeRef;
  fileTypeName?: string;
  fileFieldFilter?: Record<string, unknown>;
}): Promise<undefined | T> {
  let here = globalThis as any;
  if (!here._CARDSTACK_FILE_CHOOSER) {
    throw new Error(
      `no cardstack file chooser is available in this environment`,
    );
  }
  let chooser: FileChooser = here._CARDSTACK_FILE_CHOOSER;

  return await chooser.chooseFile<T>(opts);
}

import type { CardErrorJSONAPI } from './error.ts';
import type { SingleCardDocument } from './document-types.ts';
export type AutoSaveState = {
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  lastSaved: number | undefined;
  lastSaveError: CardErrorJSONAPI | Error | undefined;
  lastSavedErrorMsg: string | undefined;
};
export type getCard<T extends CardDef | FileDef = CardDef> = (
  parent: object,
  id: () => string | undefined,
  opts?: { type?: StoreReadType },
) => // This is a duck type of the CardResource
{
  id: string | undefined;
  card: T | undefined;
  cardError: CardErrorJSONAPI | undefined;
  isLoaded: boolean;
  autoSaveState: AutoSaveState | undefined;
};
export type getCardCollection<T extends CardDef = CardDef> = (
  parent: object,
  ids: () => string[] | undefined,
) => // This is a duck type of the CardResource
{
  ids: string[] | undefined;
  cards: T[];
  cardErrors: CardErrorJSONAPI[];
  isLoaded: boolean;
};
// Generic over `CardDef | FileDef` (defaulting to `CardDef`) to match the
// resource backing it — `StoreService.getSearchResource`, `SearchResource`, and
// `getSearch` are all `<T extends CardDef | FileDef = CardDef>`. A file-typed
// search (`getCards<FileDef>(...)`) is then `FileDef`-typed end to end instead
// of a `CardDef[]` the caller has to cast.
export type getCards<T extends CardDef | FileDef = CardDef> = (
  parent: object,
  getQuery: () => Query | undefined,
  getRealms?: () => string[] | undefined,
  opts?: {
    isLive?: true;
    doWhileRefreshing?: (() => void) | undefined;
  },
) => // This is a duck type of the SearchResource
{
  instances: T[];
  instancesByRealm: { realm: string; cards: T[] }[];
  isLoading: boolean;
  meta: QueryResultsMeta;
};

export interface CreateOptions {
  realm?: string;
  localDir?: LocalPath;
  relativeTo?: RealmResourceIdentifier | URL | undefined;
}

export interface AddOptions extends CreateOptions {
  doNotPersist?: boolean;
  doNotWaitForPersist?: boolean;
}

export type StoreReadType = 'card' | 'file-meta';

export interface Store {
  save(id: string): void;
  create(
    doc: LooseSingleCardDocument,
    opts?: CreateOptions,
  ): Promise<string | CardErrorJSONAPI>;
  add<T extends CardDef>(
    instanceOrDoc: T | LooseSingleCardDocument,
    opts?: CreateOptions & { doNotPersist: true },
  ): Promise<T>;
  add<T extends CardDef>(
    instanceOrDoc: T | LooseSingleCardDocument,
    opts?: CreateOptions & { doNotWaitForPersist: true },
  ): Promise<T>;
  add<T extends CardDef>(
    instanceOrDoc: T | LooseSingleCardDocument,
    opts?: CreateOptions,
  ): Promise<T | CardErrorJSONAPI>;
  peek<T extends CardDef>(
    id: string,
    opts?: { type?: 'card' },
  ): T | CardErrorJSONAPI | undefined;
  peek<T extends FileDef>(
    id: string,
    opts: { type: 'file-meta' },
  ): T | CardErrorJSONAPI | undefined;
  peekError(id: string, opts?: { type?: 'card' }): CardErrorJSONAPI | undefined;
  peekError(
    id: string,
    opts: { type: 'file-meta' },
  ): CardErrorJSONAPI | undefined;
  get<T extends CardDef>(
    id: string,
    opts?: { type?: 'card' },
  ): Promise<T | CardErrorJSONAPI>;
  get<T extends FileDef>(
    id: string,
    opts: { type: 'file-meta' },
  ): Promise<T | CardErrorJSONAPI>;
  delete(id: string): Promise<void>;
  patch<T extends CardDef>(
    id: string,
    patchData: PatchData,
    opts?: { doNotPersist?: boolean; clientRequestId?: string },
  ): Promise<T | CardErrorJSONAPI | undefined>;
  // `scope` pins which rows the search returns and drives the element type:
  // 'files' → `FileDef[]`, 'all' → `(CardDef | FileDef)[]`, and 'cards' (or
  // omitted) → `CardDef[]`. When omitted the scope is inferred from the filter —
  // an untyped query defaults to 'cards'. Prefer passing it explicitly over
  // shaping the filter to coax a scope. Note: 'all' returns a card's instance
  // row *and* its dual-indexed `.json` file row, so an untyped `scope: 'all'`
  // search yields each card twice unless the caller dedups
  // (e.g. `excludeCardInstanceFileRows()`).
  //
  // The element type follows the runtime `scope` argument rather than a free
  // caller-supplied type parameter, so a file-scoped search is `FileDef`-typed
  // without a cast and a card-scoped search cannot be mis-asserted as files.
  search(
    query: Query,
    realmURLs: string[] | undefined,
    opts: { scope: 'files' },
  ): Promise<FileDef[]>;
  search(
    query: Query,
    realmURLs: string[] | undefined,
    opts: { scope: 'all' },
  ): Promise<(CardDef | FileDef)[]>;
  search<T extends CardDef = CardDef>(
    query: Query,
    realmURLs?: string[],
    opts?: { scope?: 'cards' },
  ): Promise<T[]>;
  getSaveState(id: string): AutoSaveState | undefined;
}

export type CardChooserQuery = Query & {
  filter?: CardTypeFilter | EveryFilter;
};

export interface CardCreator {
  create(
    ref: CodeRef,
    relativeTo: RealmResourceIdentifier | URL | undefined,
    opts?: {
      realmURL?: URL;
      doc?: LooseSingleCardDocument;
    },
  ): Promise<string>;
}

export interface RealmSubscribe {
  subscribe(realmURL: string, cb: (ev: RealmEventContent) => void): () => void;
}

export function subscribeToRealm(
  realmURL: string,
  cb: (ev: RealmEventContent) => void,
): () => void {
  let here = globalThis as any;
  if (!here._CARDSTACK_REALM_SUBSCRIBE) {
    console.warn(
      `subscribeToRealm: no subscription handler registered for ${realmURL}; callbacks will never fire`,
    );
    // eventually we'll support subscribing to a realm in node since this will
    // be how realms will coordinate with one another, but for now do nothing
    return () => {
      /* do nothing */
    };
  } else {
    let realmSubscribe: RealmSubscribe = here._CARDSTACK_REALM_SUBSCRIBE;
    return realmSubscribe.subscribe(realmURL, (ev) => {
      cb(ev);
    });
  }
}

export interface SearchQuery {
  instances: CardDef[];
  isLoading: boolean;
}

export interface CopyCardsWithCodeRef {
  sourceCard: CardDef;
  codeRef?: ResolvedCodeRef; // if provided the card will point to a new code ref
}

export function hasExecutableExtension(path: string): boolean {
  for (let extension of executableExtensions) {
    if (path.endsWith(extension) && !path.endsWith('.d.ts')) {
      return true;
    }
  }
  return false;
}

export function hasCardExtension(path: string): boolean {
  for (let extension of cardExtensions) {
    if (path.endsWith(extension)) {
      return true;
    }
  }
  return false;
}

// Trimming preserves the form of what it is given: an identifier stays an
// identifier, and a plain string — a URL href, say — stays a plain string
// rather than acquiring a brand it does not warrant.
export function trimExecutableExtension(
  input: RealmResourceIdentifier,
): RealmResourceIdentifier;
export function trimExecutableExtension(input: string): string;
export function trimExecutableExtension(input: string): string {
  for (let extension of executableExtensions) {
    if (input.endsWith(extension)) {
      return input.replace(new RegExp(`\\${extension}$`), '');
    }
  }
  return input;
}

export function internalKeyFor(
  ref: CodeRef,
  relativeTo: RealmResourceIdentifier | URL | undefined,
  virtualNetwork: VirtualNetwork,
): string {
  if (!('type' in ref)) {
    let resolved = virtualNetwork.resolveURL(ref.module, relativeTo).href;
    let module: string = trimExecutableExtension(rri(resolved));
    // Use the prefix form (e.g. @cardstack/catalog/foo) as the canonical
    // internal key when a registered prefix mapping matches
    module = virtualNetwork.unresolveURL(module);
    return `${module}/${ref.name}`;
  }
  switch (ref.type) {
    case 'ancestorOf':
      return `${internalKeyFor(ref.card, relativeTo, virtualNetwork)}/ancestor`;
    case 'fieldOf':
      return `${internalKeyFor(ref.card, relativeTo, virtualNetwork)}/fields/${ref.field}`;
  }
}

export function codeRefFromInternalKey(
  internalKey: string | null | undefined,
): ResolvedCodeRef | undefined {
  if (!internalKey) {
    return;
  }
  if (internalKey.includes('/fields/')) {
    return;
  }
  if (internalKey.endsWith('/ancestor')) {
    return;
  }
  let lastSlash = internalKey.lastIndexOf('/');
  if (lastSlash <= 0 || lastSlash === internalKey.length - 1) {
    return;
  }
  return {
    module: internalKey.slice(0, lastSlash) as RealmResourceIdentifier,
    name: internalKey.slice(lastSlash + 1),
  };
}

export function loaderFor(cardOrField: CardDef | FieldDef) {
  let clazz = Reflect.getPrototypeOf(cardOrField)!.constructor;
  let loader = Loader.getLoaderFor(clazz);
  if (!loader) {
    throw new Error(`bug: could not determine loader for card or field`);
  }
  return loader;
}

export async function apiFor(
  cardOrFieldType: typeof CardDef | typeof FieldDef | typeof BaseDef,
): Promise<typeof CardAPI>;
export async function apiFor(
  cardOrField: CardDef | FieldDef | BaseDef,
): Promise<typeof CardAPI>;
export async function apiFor(
  cardOrFieldOrClass:
    | CardDef
    | FieldDef
    | BaseDef
    | typeof CardDef
    | typeof FieldDef
    | typeof BaseDef,
) {
  let loader =
    Loader.getLoaderFor(cardOrFieldOrClass) ??
    loaderFor(cardOrFieldOrClass as CardDef | FieldDef | BaseDef);
  let api = await loader.import<typeof CardAPI>('@cardstack/base/card-api');
  if (!api) {
    throw new Error(`could not load card API`);
  }
  return api;
}

export function splitStringIntoChunks(str: string, maxSizeKB: number) {
  const maxSizeBytes = maxSizeKB * 1024;
  let chunks = [];
  let startIndex = 0;
  while (startIndex < str.length) {
    // Calculate the end index of the chunk based on byte length
    let endIndex = startIndex;
    let byteLength = 0;
    while (endIndex < str.length && byteLength < maxSizeBytes) {
      let charCode = str.charCodeAt(endIndex);
      // we use this approach so that we can have an isomorphic means of
      // determining the byte size for strings, as well as, using Blob (in the
      // browser) to calculate string byte size is pretty expensive
      byteLength += charCode < 0x0080 ? 1 : charCode < 0x0800 ? 2 : 3;
      endIndex++;
    }
    let chunk = str.substring(startIndex, endIndex);
    chunks.push(chunk);
    startIndex = endIndex;
  }
  return chunks;
}

export function uint8ArrayToHex(uint8: Uint8Array) {
  return Array.from(uint8)
    .map((i) => i.toString(16).padStart(2, '0'))
    .join('');
}

export function unixTime(epochTimeMs: number) {
  return Math.floor(epochTimeMs / 1000);
}

// A local id is a client-minted token for an instance that has not yet been
// saved to a realm — it is neither a URL nor a prefix-form RRI. Both remote
// forms are syntactically distinguishable (URLs start with `http`, prefix-form
// RRIs start with `@`), so this needs no VirtualNetwork: identifiers are
// canonical RRI by the time they reach here.
export function isLocalId(id: string) {
  return !id.startsWith('http') && !id.startsWith('@');
}

export function isBrowserTestEnv() {
  return typeof window !== 'undefined' && Boolean((globalThis as any).QUnit);
}

export * from './search-results-component.ts';
export { isBotTriggerEvent } from './bot-trigger.ts';
export {
  assertIsBotCommandFilter,
  isBotCommandFilter,
  type BotCommandFilter,
  type BotCommandMatrixFilter,
} from './bot-command.ts';
