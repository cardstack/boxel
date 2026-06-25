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
import type { ErrorEntry } from './error.ts';
import { rri, type RealmResourceIdentifier } from './realm-identifiers.ts';

import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';
import type { FileDef } from 'https://cardstack.com/base/file-api';

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
  // Wall-clock of the host-side searchDoc call.
  searchDocMs?: number;
  // Broken `linksTo` / `linksToMany` targets found on the rendered
  // instance after the store settled. Captured by the render.meta scan
  // and persisted to `boxel_index.diagnostics.brokenLinks` so
  // cards-with-broken-links are cheaply enumerable. Omitted entirely
  // when the card has no broken links.
  brokenLinks?: BrokenLinkSummary[];
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
  // Plumbed from the producer side via `Job.priority`. `0` is the
  // system-initiated default; `10` is user-initiated. Read in post-
  // mortems and in `prerender-queue-snapshot` triage to tell whether a
  // stalled render was background or user-priority work.
  priority?: number;
  // Whether this render landed on a tab that was already bound to its
  // affinity. `true` = warm tab, fast launch + cached BrowserContext
  // fetches. `false` = a freshly spawned or commandeered tab — pays
  // the cold-start cost. Triage signal: a slow render with
  // `tabReused=false` is a cold-start tax (look at `tabStartupMs`);
  // with `tabReused=true` it's a real render-side stall.
  tabReused?: boolean;
  // Total wall time spent in `PagePool.getPage` before render work
  // began. The three `waits` sub-fields below each cover a specific
  // await; `launchMs` is measured around the full method and so is
  // typically >= `semaphoreMs + tabQueueMs + tabStartupMs` — the
  // residual is synchronous bookkeeping (affinity reassignment,
  // LRU touch, standby top-up kickoff) that doesn't fall into any
  // of the three buckets. For triage the sub-field breakdown is
  // what matters: which *await* dominated launch time.
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
  };
  // Elapsed between render start and the timeout. If ~= timeoutMs the
  // render itself stalled; if << timeoutMs the launch dominated.
  renderElapsedMs?: number;
  // Sum of launch + render elapsed (server-observed).
  totalElapsedMs?: number;
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

// The shape persisted to `boxel_index.diagnostics`. Named `Diagnostics`
// (not `TimingDiagnostics`) because the block is no longer purely about
// timing: it also carries `brokenLinks`, the broken-link findings the
// render surfaced. Extends `RenderTimeoutDiagnostics` (which already
// carries `requestId`) with two write-side stamps applied at
// `IndexWriter.updateEntry` time:
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
  // Frontmatter YAML that wouldn't parse during file extraction. The row
  // still indexes (body-only); this is the only indexed signal that the
  // file's frontmatter — and anything it declared — was dropped. Merged in
  // by the file indexer from the extract response. Absent when the
  // frontmatter parsed (or there was none).
  frontmatterParseError?: FrontmatterParseError;
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
  // in-flight low-priority render runs to completion. Defaults to 0
  // when absent (system-priority).
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

export type PrerenderVisitArgs = {
  affinityType: AffinityType;
  affinityValue: string;
  realm: string;
  url: string;
  auth: string;
  renderOptions?: RenderRouteOptions;
  // Inputs required only when the fileRender pass is requested
  fileData?: FileRenderArgs['fileData'];
  types?: string[];
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
};

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

export type ScreenshotPrerenderArgs = {
  realm: string;
  url: string;
  auth: string;
  format: 'isolated' | 'embedded';
  // Worker-job priority threaded through from the producer side. See
  // ModulePrerenderArgs for the contract.
  priority?: number;
};

export type ScreenshotPrerenderResponse = {
  status: 'ready' | 'error' | 'unusable';
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
  sanitizeForJsonb,
  ERROR_DOC_MAX_BYTES,
  ERROR_DOC_MAX_ADDITIONAL_ERRORS,
} from './error.ts';
export { validateWriteSize } from './write-size-validation.ts';

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
export * from './paths.ts';
export * from './realm-client.ts';
export * from './realm-operations.ts';
export * from './published-realm-url.ts';
export * from './realm-index-card.ts';
export * from './cached-fetch.ts';
export * from './definition-lookup.ts';
export * from './definitions.ts';
export * from './catalog.ts';
export * from './commands.ts';
export * from './realm-identifiers.ts';
export * from './bfm-card-references.ts';
export * from './bfm-math-render.ts';
export * from './bfm-mermaid-render.ts';
export * from './constants.ts';
export * from './helpers/const.ts';
export * from './document.ts';
export * from './matrix-constants.ts';
export * from './matrix-client.ts';
export * from './queue.ts';
export * from './job-utils.ts';
export * from './expression.ts';
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
export * from './instance-filter-matcher.ts';
export * from './search-utils.ts';
export * from './search-resource-helpers.ts';
export * from './search-entry.ts';
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
  SearchEntryCollectionDocument,
  SearchEntryIncludedResource,
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
  isSearchEntryCollectionDocument,
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

import type {
  CardDef,
  FieldDef,
  BaseDef,
} from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
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
export type getCards<T extends CardDef = CardDef> = (
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
  search(query: Query, realmURLs?: string[]): Promise<CardDef[]>;
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

export function trimExecutableExtension(
  input: RealmResourceIdentifier,
): RealmResourceIdentifier {
  for (let extension of executableExtensions) {
    if (input.endsWith(extension)) {
      return input.replace(
        new RegExp(`\\${extension}$`),
        '',
      ) as RealmResourceIdentifier;
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

// Like `internalKeyFor`, but returns every equivalent spelling of the key —
// the RRI-prefix, real-URL, and virtual-alias forms. Type predicates compare
// a single stored `types` value against a key; index rows written before
// references were canonicalized to RRI may hold the alias or real-URL form,
// so matching all spellings keeps base-typed cards/files findable until the
// persisted data is migrated or reindexed.
export function internalKeysFor(
  ref: CodeRef,
  relativeTo: RealmResourceIdentifier | URL | undefined,
  virtualNetwork: VirtualNetwork,
): string[] {
  if (!('type' in ref)) {
    let resolved = virtualNetwork.resolveURL(ref.module, relativeTo).href;
    let module: string = trimExecutableExtension(rri(resolved));
    return virtualNetwork
      .equivalentURLForms(module)
      .map((form) => `${form}/${ref.name}`);
  }
  switch (ref.type) {
    case 'ancestorOf':
      return internalKeysFor(ref.card, relativeTo, virtualNetwork).map(
        (key) => `${key}/ancestor`,
      );
    case 'fieldOf':
      return internalKeysFor(ref.card, relativeTo, virtualNetwork).map(
        (key) => `${key}/fields/${ref.field}`,
      );
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

export function isLocalId(id: string, virtualNetwork: VirtualNetwork) {
  return !id.startsWith('http') && !virtualNetwork.isRegisteredPrefix(id);
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
