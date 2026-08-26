import * as ContentTag from 'content-tag';
import { init as lexerReady, parse as lexImports } from 'es-module-lexer';
import { md5 } from 'super-fast-md5';

import { isTrustedImport, isTrustedModule } from './trusted-modules';

/**
 * The reason kinds classification can produce, declared rather than spelled
 * inline at each return, because a reason string is API: it feeds the
 * named-diagnostics catalog, the classification telemetry event, and the
 * author-facing security-context indicator. A consumer parses a reason by
 * splitting on the first `:` — the kind is the whole string for the four that
 * carry no payload, and the prefix for the rest.
 *
 *   `trusted-module`               the entry is Host-owned and runs Direct
 *   `authored-module`              authored code with an established graph
 *   `source-parse-pending`         the ENTRY's source did not parse
 *   `module-graph-limit`           the reachable graph exceeded its bound
 *   `module-load:<url>`            a graph member's source did not load
 *   `module-parse:<url>`           a DEPENDENCY's source did not parse
 *   `module-resolve:<specifier>`   an import specifier did not resolve
 *
 * Only the first two describe an established result. The rest each mean the
 * walk could not establish the graph, which RP-6.7 fails closed: the module
 * graph is a read-authorization list, so a truncated one would refuse fetches
 * the render needs rather than merely render something stale.
 *
 * Which failure a given cause reports depends on the resolver it is given, and
 * the Host's does not throw: `VirtualNetwork.resolveImport` answers an unknown
 * bare specifier with a `packages` pseudo-origin URL rather than refusing it,
 * so such an import is reported as `module-load:` when nothing serves that URL.
 * `module-resolve:` is for a resolver that refuses outright. Both fail closed;
 * a consumer that presents these to an author should treat them as one
 * condition with two spellings rather than as two different diagnoses.
 */
export const MODULE_CLASSIFICATION_REASON_KINDS = [
  'trusted-module',
  'authored-module',
  'source-parse-pending',
  'module-graph-limit',
  'module-load',
  'module-parse',
  'module-resolve',
] as const;

export type ModuleClassificationReasonKind =
  (typeof MODULE_CLASSIFICATION_REASON_KINDS)[number];

/** One module's classification. */
export interface BoxelModuleClassification {
  /**
   * The module is Host-owned and executes Direct (RP-6.1 R1, RP-6.6). Decided
   * from the identifier alone by `isTrustedModule`, so nothing in this
   * result's own construction — no source, no cache, no hash — can reach it.
   */
  trusted: boolean;

  /**
   * Every module identifier the walk reached, entry first and the rest sorted.
   * This is the exact set a stronger runtime may read: a Sandbox authorizes a
   * module fetch against it before any authenticated request fires.
   *
   * An authorization list only when `moduleGraphComplete` says so.
   *
   * Spellings are mixed by construction: an authored dependency appears as
   * `resolveImport` returned it, while a module the Host provides appears as
   * the specifier the author wrote, because resolving one can evaluate it. A
   * gate comparing a requested URL against this list must therefore reproduce
   * the runtime's own resolution before comparing — the Loader's identifier
   * folding (`moduleCacheKey`, `trimExecutableExtension`) AND the import-map
   * transforms that send a package specifier somewhere else entirely, as
   * `@cardstack/boxel-icons/mail` is rewritten onto the icons host. An exact
   * string comparison refuses fetches for modules that are in the list.
   */
  moduleGraph: readonly string[];

  /**
   * Whether the walk read every module it reached. When false, `moduleGraph`
   * is whatever it got to before something could not be loaded, parsed,
   * resolved, or fitted inside the bound — a diagnostic, not an authorization
   * list, and a runtime that checked fetches against it would refuse reads the
   * render needs. Such a result is never memoized, so the caller's move is to
   * classify again rather than to authorize against it.
   *
   * This is the field to gate on rather than the reason string. The two agree
   * while every reason but the first two names a failure, and they stop
   * agreeing the moment classification also reports positive findings about a
   * module: a settled reason can then accompany a graph that stopped where an
   * unreadable member did.
   */
  moduleGraphComplete: boolean;

  /**
   * The module's own source declares at least one `static edit = …` template —
   * on the card class or on any FieldDef it defines (RP-6.8). It is the input
   * RP-6.3's exception reads: the `edit` surface drops to the Host's trusted
   * Base editor only when no authored template would run in it.
   *
   * Established for authored modules only. A trusted module renders every
   * format Direct, so no surface reads this and the walk does not fetch its
   * source to establish it.
   */
  authoredEditTemplate: boolean;

  /** One of `MODULE_CLASSIFICATION_REASON_KINDS`, with a payload where noted. */
  reason: string;

  /**
   * Reserved for the browser-authority findings a later analyzer reports about
   * the same module. Never populated here, so a consumer that reads it gets
   * `undefined` rather than an empty list that would read as "analyzed, none
   * found".
   */
  signals?: string[];
}

export interface BoxelModuleClassifierOptions {
  /** Authored source for one module, as the realm serves it. */
  loadSource(moduleIdentifier: string): Promise<string>;

  /**
   * One import specifier as the runtime would resolve it, or a throw when it
   * does not resolve. Both halves of resolution belong to the caller — mapping
   * a bare specifier to the identifier its runtime serves it under, and
   * resolving a relative one against the importing module — because the
   * classifier must not assume either.
   */
  resolveImport(specifier: string, relativeTo: string): string;

  /**
   * Modules the runtime answers from its own registry rather than by fetching
   * authored source: the loader's shims. Consulted in addition to
   * `isTrustedImport`, whose set is the framework floor every runtime
   * provides, because a runtime also shims ordinary libraries a card may
   * import (`date-fns`, `lodash`, `ember-concurrency`). Such a module is
   * recorded as a graph edge and not walked — there is no authored source
   * behind it, and a walk that went looking would fail the whole graph closed.
   *
   * Asked about BOTH spellings: the specifier as authored, before anything is
   * resolved, and the resolved identifier of a dependency. A predicate that
   * answers only one of the two half-works — it prunes some edges and sends
   * the walk after others.
   */
  isHostProvidedModule?(moduleIdentifier: string): boolean;

  /**
   * The number of module reads one walk will attempt. A read that fails counts,
   * so unreadable imports cannot outrun the bound; modules the walk prunes at
   * do not, since they are never read.
   */
  maxModules?: number;
}

const defaultMaxModules = 256;

// content-tag surfaces this in "Parse Error at ..." messages. Classification
// discards those — an unreadable module is reported by identifier — so the
// name is a constant rather than the module's own URL.
const preprocessorFilename = 'boxel-source.gts';

// Preprocessing a `<template>` block rewrites it into a call, and content-tag
// adds this import to supply the callee. It is an artifact of reading the
// source, not an edge the author wrote and not one the realm serves — the
// realm's own pipeline runs Babel after this step, which rewrites the call and
// removes the import again — so it is dropped rather than admitted to every
// templated card's graph. A card importing the module itself loses the
// recorded edge with it; no runtime serves that specifier, so the edge would
// have failed the graph closed rather than authorizing anything.
const templateCompilerModule = '@ember/template-compiler';

// `static edit = …` in a class body declares an authored in-place editor
// (RP-6.8). Matched against the preprocessed JavaScript, where a template
// block has become a call rather than markup, so the class-body assignment is
// what this reads.
//
// The annotated form matters as much as the bare one: content-tag does not
// strip TypeScript (the realm's Babel pass does, later), and
// `static edit: BaseDefComponent = Editor` is what the Base realm's own cards
// write, so an author following that example must not read as declaring
// nothing.
//
// The two ways this can be wrong are not symmetric. A false POSITIVE — the
// text appearing in a comment, a string, or a template body — keeps the edit
// surface in the stronger cage, which is always allowed. A false NEGATIVE
// hands a surface that does contain authored code to the trusted Base editor,
// which is a containment failure, so the pattern is written to err toward
// matching.
const authoredEditTemplatePattern = /\bstatic\s+edit\s*[:=]/;

const preprocessor = new ContentTag.Preprocessor();

/**
 * A memoized result is handed to every caller that asks for the same module,
 * so one consumer sorting the graph in place or pushing to it would corrupt
 * the read authority every other holder is checking against. Both the list and
 * the record around it are frozen before anyone sees them.
 */
function sealed(
  classification: BoxelModuleClassification,
): BoxelModuleClassification {
  Object.freeze(classification.moduleGraph);
  return Object.freeze(classification);
}

/** What one module's source says about itself. */
interface SourceAnalysis {
  /** Import specifiers as authored, before resolution. */
  imports: string[];
  authoredEditTemplate: boolean;
}

/**
 * Reads one module's source. The code is never executed to read it.
 *
 * The front end is the realm's own: content-tag's `process()`, which is what
 * `transpile.ts` runs before Babel. Matching it is what makes "the front end
 * refused this" mean "an in-progress draft" rather than "syntax the realm
 * serves and this file cannot read", and that distinction is expensive to get
 * wrong: a draft result yields an EMPTY module graph, and the module graph is
 * a sandbox child's fetch authority.
 *
 * `process()` rewrites each `<template>` block into a call, so its output
 * parses wherever a template can appear — including expression position
 * (`const Row = <template>…</template>;`), where blanking the block instead
 * would leave a hole an expression has to fill and make a finished, servable
 * module read as unparseable.
 *
 * Returns undefined when the source did not parse.
 */
async function analyzeSource(
  source: string,
): Promise<SourceAnalysis | undefined> {
  await lexerReady;
  let javascript: string;
  try {
    javascript = preprocessor.process(source, {
      filename: preprocessorFilename,
    }).code;
  } catch {
    return undefined;
  }
  let specifiers: (string | undefined)[];
  try {
    // The lexer reports a literal dynamic import (`import('./x')`) with its
    // specifier set, so it joins the graph as an ordinary edge. A computed one
    // — including a template literal — is reported with no specifier: it
    // cannot be statically authorized, so it is simply absent from the graph
    // and the runtime's fetch gate refuses it.
    specifiers = lexImports(javascript)[0].map((entry) => entry.n);
  } catch {
    return undefined;
  }
  let imports = new Set<string>();
  for (let specifier of specifiers) {
    if (specifier !== undefined && specifier !== templateCompilerModule) {
      imports.add(specifier);
    }
  }
  return {
    imports: [...imports],
    authoredEditTemplate: authoredEditTemplatePattern.test(javascript),
  };
}

/**
 * Everything one module's analysis could not establish. Plural because a
 * module with two unresolvable imports has two facts to report, and reporting
 * only the first one reached would make the diagnostic depend on the order the
 * imports appear in.
 */
class ModuleGraphFailure extends Error {
  constructor(readonly reasons: string[]) {
    super(reasons.join(', '));
  }
}

interface ModuleAnalysis {
  /** Absent when the module's source did not parse. */
  source: SourceAnalysis | undefined;
  /** Resolved dependency identifiers, deduplicated and sorted. */
  dependencies: string[];
}

/**
 * The one reason a result carries, out of everything the walk observed.
 *
 * An entry whose own source did not parse is reported as the draft it is. That
 * case excludes every other: a module whose imports are unknown enqueues
 * nothing, so there is no graph behind it to have failed — it is written first
 * for the reader rather than to win a contest. An entry that could not be READ
 * at all is not a draft, and falls through to the failure that says so. The bound
 * comes next — once it is hit the walk stopped early, so which OTHER modules
 * failed is an artifact of where it stopped. Remaining failures are sorted, so
 * the reported one is a property of the graph rather than of the order the
 * walk reached its members in.
 */
function reasonFor({
  exceededLimit,
  failures,
}: {
  exceededLimit: boolean;
  failures: string[];
}): string {
  if (failures.includes('source-parse-pending')) {
    return 'source-parse-pending';
  }
  if (exceededLimit) {
    return 'module-graph-limit';
  }
  return failures.length > 0
    ? [...failures].sort()[0]!
    : ('authored-module' satisfies ModuleClassificationReasonKind);
}

interface WalkState {
  /** Every identifier reached, so invalidation can find the entry by any. */
  graph: Set<string>;
  /** Set the moment the walk fails to read something it reached. */
  incomplete: boolean;
}

/**
 * Classifies an authored module graph — the entry module and everything
 * reachable from it — rather than only the entry file.
 *
 * The walk prunes at modules the Host serves itself (RP-6.6): their source is
 * never fetched and their own imports are never followed, because the Host
 * resolves them for whichever runtime asked. Everything else is authored and
 * is read. A dependency that cannot be resolved, loaded, or parsed, and a
 * graph that outgrows its bound, mark the result's graph unavailable with a
 * diagnostic reason (RP-6.7).
 *
 * Two caches, invalidated together:
 *
 *   - a per-MODULE memo, shared across every entry, so two cards sharing a
 *     dependency subtree read and analyze it once and the second card fetches
 *     none of it. It holds only what the loader served, never a caller's
 *     draft.
 *   - a per-ENTRY memo of the finished classification, which records the graph
 *     it was computed from so invalidating any member evicts it.
 *
 * `invalidate(module)` evicts that module's analysis and every entry whose
 * graph reached it. A result that reports what could not be established is
 * never memoized, so the next request retries rather than pinning a transient
 * fetch failure or an in-progress draft.
 *
 * Neither cache has a size bound: both hold what they are told about until
 * `invalidate` drops it, since the invalidation signal is the realm's and
 * arrives per changed module rather than under memory pressure. `maxModules`
 * bounds one WALK, not the caches. A holder that outlives many module graphs
 * wants `invalidate()` at whatever point its own module identities stop being
 * meaningful — a loader reset, a session ending.
 */
export class BoxelModuleClassifier {
  // Promises rather than values, so entries walking concurrently share one
  // fetch and one analysis of a module they both reach.
  private moduleAnalyses = new Map<string, Promise<ModuleAnalysis>>();
  private entries = new Map<
    string,
    {
      classification: Promise<BoxelModuleClassification>;
      /** Set when the caller supplied source; absent when it was fetched. */
      sourceHash?: string;
      graph: Set<string>;
    }
  >();

  constructor(private readonly options: BoxelModuleClassifierOptions) {}

  /**
   * Classifies `moduleIdentifier` and its reachable graph. Pass `source` to
   * classify a revision the loader cannot fetch — an unsaved draft. Such a
   * result is keyed by that source's hash and answers only this caller: a
   * draft never enters the memo other entries read, so an unsaved buffer
   * cannot decide the graph of a card it is not the source of.
   *
   * A trusted entry is answered from its identifier alone, without a fetch:
   * it executes Direct with the Host's own loader, which resolves its imports
   * itself, so there is no authored closure to establish.
   */
  classifyModule(
    moduleIdentifier: string,
    source?: string,
  ): Promise<BoxelModuleClassification> {
    if (isTrustedModule(moduleIdentifier)) {
      return Promise.resolve(
        sealed({
          trusted: true,
          moduleGraph: [moduleIdentifier],
          moduleGraphComplete: true,
          authoredEditTemplate: false,
          reason: 'trusted-module',
        }),
      );
    }
    let sourceHash = source === undefined ? undefined : md5(source);
    let existing = this.entries.get(moduleIdentifier);
    if (existing && existing.sourceHash === sourceHash) {
      return existing.classification;
    }
    // The walk fills both fields as it goes: `graph` so invalidation can find
    // this entry by any member, and `incomplete` so a result computed over a
    // graph the walk could not establish is not kept as an answer.
    let walk: WalkState = {
      graph: new Set<string>([moduleIdentifier]),
      incomplete: false,
    };
    let classification = this.walkGraph(moduleIdentifier, source, walk);
    let entry = { classification, sourceHash, graph: walk.graph };
    this.entries.set(moduleIdentifier, entry);
    let evict = () => {
      if (this.entries.get(moduleIdentifier) === entry) {
        this.entries.delete(moduleIdentifier);
      }
    };
    // An incomplete walk is not an answer to keep: the module may load next
    // time, the draft may parse next time — and until then the graph it
    // produced is a read-authorization list drawn over a hole. The eviction
    // reads the resolved value rather than only catching a rejection, because
    // the walk reports such a result rather than throwing it.
    void classification.then(
      ({ moduleGraphComplete }) => (moduleGraphComplete ? undefined : evict()),
      evict,
    );
    return classification;
  }

  /**
   * Drops cached work. With a module identifier, that is the module's own
   * analysis plus every entry whose graph reached it — an entry's graph is the
   * closure of its dependencies, so a stale importer is as wrong as a stale
   * dependency. With no argument, everything.
   */
  invalidate(moduleIdentifier?: string): void {
    if (moduleIdentifier === undefined) {
      this.moduleAnalyses.clear();
      this.entries.clear();
      return;
    }
    this.moduleAnalyses.delete(moduleIdentifier);
    for (let [identifier, entry] of this.entries) {
      if (
        identifier === moduleIdentifier ||
        entry.graph.has(moduleIdentifier)
      ) {
        this.entries.delete(identifier);
      }
    }
  }

  private async walkGraph(
    moduleIdentifier: string,
    entrySource: string | undefined,
    walk: WalkState,
  ): Promise<BoxelModuleClassification> {
    let maxModules = this.options.maxModules ?? defaultMaxModules;
    // The complete reachable graph is collected before anything is read off
    // it, so a diamond reached from either side and a cycle entered at either
    // end produce the same graph and the same reported failure: traversal
    // order cannot reach the result.
    let analyzed = new Map<string, ModuleAnalysis>();
    // Every identifier the walk has taken a turn on, whether or not it yielded
    // an analysis. The bound counts these rather than the successful analyses:
    // a module that fails to load or resolve contributes nothing to
    // `analyzed`, so counting successes would let one module declaring
    // thousands of unreadable imports issue thousands of authenticated loads
    // inside a walk that reports itself bounded. It is also what dedupes a
    // failure within one walk — a failed module self-evicts from the shared
    // memo, so a second importer reaching it would otherwise read it again.
    let attempted = new Set<string>();
    let failures: string[] = [];
    let exceededLimit = false;
    let queue: { identifier: string; suppliedSource?: string }[] = [
      { identifier: moduleIdentifier, suppliedSource: entrySource },
    ];

    while (queue.length > 0) {
      let { identifier, suppliedSource } = queue.shift()!;
      if (attempted.has(identifier)) {
        continue;
      }
      if (attempted.size >= maxModules) {
        exceededLimit = true;
        walk.incomplete = true;
        break;
      }
      attempted.add(identifier);
      let analysis: ModuleAnalysis;
      try {
        analysis = await this.analyzeModule(identifier, suppliedSource);
      } catch (error) {
        if (!(error instanceof ModuleGraphFailure)) {
          throw error;
        }
        failures.push(...error.reasons);
        walk.incomplete = true;
        continue;
      }
      analyzed.set(identifier, analysis);
      // Source that did not parse leaves the walk with no imports for that
      // module, so its closure is unproven either way. The entry's own draft
      // says so as `source-parse-pending`, which is the ordinary state of a
      // module being typed into; a DEPENDENCY that will not parse is a fact
      // about saved code and is named as one.
      if (analysis.source === undefined) {
        walk.incomplete = true;
        failures.push(
          identifier === moduleIdentifier
            ? 'source-parse-pending'
            : `module-parse:${identifier}`,
        );
        continue;
      }
      for (let dependency of analysis.dependencies) {
        walk.graph.add(dependency);
        if (!this.isGraphLeaf(dependency)) {
          queue.push({ identifier: dependency });
        }
      }
    }

    let moduleGraph = [
      moduleIdentifier,
      ...[...walk.graph]
        .filter((identifier) => identifier !== moduleIdentifier)
        .sort(),
    ];
    let root = analyzed.get(moduleIdentifier);
    return sealed({
      trusted: false,
      moduleGraph,
      moduleGraphComplete: !walk.incomplete,
      authoredEditTemplate: root?.source?.authoredEditTemplate ?? false,
      reason: reasonFor({ exceededLimit, failures }),
    });
  }

  /**
   * Whether the walk records this dependency as an edge without following it.
   * A module the Host serves — a trusted one, or one the runtime shims — has
   * no authored source behind it to read, and its own dependencies are the
   * Host's to resolve for whichever runtime asked.
   */
  private isGraphLeaf(moduleIdentifier: string): boolean {
    return (
      isTrustedImport(moduleIdentifier) ||
      (this.options.isHostProvidedModule?.(moduleIdentifier) ?? false)
    );
  }

  /**
   * Returns one module's analysis, from the shared memo when it holds one.
   *
   * With no supplied source the memo is authoritative and nothing is fetched —
   * that is what lets a second entry traverse a shared subtree for free.
   */
  private async analyzeModule(
    moduleIdentifier: string,
    suppliedSource?: string,
  ): Promise<ModuleAnalysis> {
    // Supplied source is one caller's revision of the module, not the module.
    // The shared memo answers every entry that reaches this identifier, so
    // seating a draft in it would let an unsaved editor buffer decide the
    // module graph — the read authority — of a card it is not the source of.
    // A draft is therefore analyzed for its own caller and neither read from
    // nor written to the shared memo; the entry memo, keyed by the draft's
    // hash, is what keeps an unchanged draft from re-analyzing.
    if (suppliedSource !== undefined) {
      return this.freshAnalysis(moduleIdentifier, suppliedSource);
    }
    let pending = this.moduleAnalyses.get(moduleIdentifier);
    if (pending) {
      // A rejection propagates to this caller rather than being retried
      // mid-walk: the module already self-evicted, so the retry is the next
      // classification, and this walk reports the failure as it should.
      return pending;
    }
    let fresh = this.freshAnalysis(moduleIdentifier);
    this.moduleAnalyses.set(moduleIdentifier, fresh);
    let evict = () => {
      if (this.moduleAnalyses.get(moduleIdentifier) === fresh) {
        this.moduleAnalyses.delete(moduleIdentifier);
      }
    };
    // A rejection is not an answer, and neither is source that did not parse:
    // an in-progress draft is a state the module leaves, so keeping it would
    // pin the module to it until something invalidated the module by name.
    // The current walk still uses the value it already holds.
    void fresh.then(
      ({ source }) => (source === undefined ? evict() : undefined),
      evict,
    );
    return fresh;
  }

  private async freshAnalysis(
    moduleIdentifier: string,
    suppliedSource?: string,
  ): Promise<ModuleAnalysis> {
    let source: string;
    try {
      source =
        suppliedSource ?? (await this.options.loadSource(moduleIdentifier));
    } catch {
      throw new ModuleGraphFailure([`module-load:${moduleIdentifier}`]);
    }
    let analysis = await analyzeSource(source);
    if (analysis === undefined) {
      return { source: undefined, dependencies: [] };
    }
    let dependencies = new Set<string>();
    let unresolved: string[] = [];
    for (let specifier of analysis.imports) {
      // A specifier the Host serves is already a canonical leaf, so it is
      // recorded without being resolved. Resolving one can evaluate the module
      // merely to discover its URL — an async package shim does exactly that —
      // which would turn classification into an eager module load and pull in
      // that module's own transitive network dependencies. The runtime
      // resolves the reference only if authored code actually uses the export.
      if (this.isGraphLeaf(specifier)) {
        dependencies.add(specifier);
        continue;
      }
      try {
        let resolved = this.options.resolveImport(specifier, moduleIdentifier);
        if (typeof resolved !== 'string') {
          throw new TypeError(
            `resolveImport did not answer with an identifier`,
          );
        }
        dependencies.add(resolved);
      } catch {
        // Collected rather than thrown, so a module with several unresolvable
        // imports reports all of them and the walk's chosen diagnostic does
        // not depend on which one appears first in the file.
        unresolved.push(`module-resolve:${specifier}`);
      }
    }
    if (unresolved.length > 0) {
      // Not memoized: a partially resolved module is not a fact about the
      // module, and resolution depends on loader state rather than on source.
      throw new ModuleGraphFailure(unresolved);
    }
    return { source: analysis, dependencies: [...dependencies].sort() };
  }
}
