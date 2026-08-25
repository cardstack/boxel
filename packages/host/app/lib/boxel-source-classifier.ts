import * as babel from '@babel/core';
// @ts-ignore no upstream types are available
import typescriptPlugin from '@babel/plugin-transform-typescript';
import * as ContentTag from 'content-tag';
import { init, parse } from 'es-module-lexer';

/**
 * The cage an authored module's own code may run in. Direct is deliberately
 * absent: only the trusted-module boundary (`trusted-modules.ts`, RP-6.1 rule
 * R1) admits a module to Direct, and this file never returns it. Nothing an
 * authored module contains can move it down.
 */
export type AuthoredExecutionMode = 'capsule' | 'sandbox';

/**
 * The reason kinds classification can produce, declared rather than spelled
 * inline at each return, because a reason string is API: it feeds the
 * named-diagnostics catalog, the classification telemetry event, and the
 * author-facing indicator. A consumer parses a reason by splitting on the
 * first `:` — the kind is the whole string for the two that carry no payload,
 * and the prefix for the rest.
 *
 *   `default-user-card`             authored code with no browser evidence
 *   `source-parse-pending`          source did not parse (see below)
 *   `browser-runtime:<signals>`     the module's own signals, comma-separated
 *   `dependency-runtime:<url>`      a dependency's signals propagated up
 *   `module-load:<url>`             a graph member's source did not load
 *   `module-resolve:<specifier>`    an import specifier did not resolve
 *   `module-analysis:<url>`         a graph member's analysis threw
 *   `module-graph-limit`            the reachable graph exceeded its bound
 *
 * Every kind but the first two resolves to Sandbox. `source-parse-pending` is
 * the one failure that resolves to Capsule, because an unparseable draft is an
 * in-progress edit rather than evidence of a browser requirement: it fails
 * into the MORE restrictive renderer, and the last good render stays on screen.
 */
export const CLASSIFICATION_REASON_KINDS = [
  'default-user-card',
  'source-parse-pending',
  'browser-runtime',
  'dependency-runtime',
  'module-load',
  'module-resolve',
  'module-analysis',
  'module-graph-limit',
] as const;

/** What one module's own source says about itself. */
export interface BoxelSourceAnalysis {
  tier: AuthoredExecutionMode;
  reason: string;
  /** Import specifiers as authored, before resolution. */
  imports: string[];
  /** The named signals behind `reason`; empty for a Capsule result. */
  signals: string[];
  /**
   * Whether this module's evidence promotes the modules that import it.
   *
   * A browser-only package import, a DOM-only method call, and a template
   * signal are all part of an exported render surface: an importer renders
   * that surface, so it needs the same browser authority. An ambient global
   * MENTION is different — a library routinely carries a browser adapter that
   * never runs in this graph, and promoting every importer for a dormant
   * `document` reference costs an iframe to cards that would otherwise render
   * in a Capsule. The mention still promotes the module that contains it,
   * where the reference would actually be evaluated.
   */
  propagatesToImporters: boolean;
}

/** One authored module graph's classification. */
export interface BoxelSourceClassification extends BoxelSourceAnalysis {
  /**
   * Every module identifier the walk reached, entry first and the rest sorted.
   * This is the exact set a stronger runtime may read: a Sandbox authorizes a
   * module fetch against it before any authenticated request fires.
   */
  moduleGraph: string[];
}

// Packages that need a real document, canvas, or WebGL context. A card
// importing one of these belongs in the Sandbox, where authored code gets a
// browser to talk to rather than a Compartment that has never heard of one.
const browserOnlyPackages = [
  '@babylonjs',
  '@google/model-viewer',
  '@react-three',
  '@tweenjs/tween.js',
  'aframe',
  'babylonjs',
  'cesium',
  'deck.gl',
  'ember-modifier',
  'konva',
  'leaflet',
  'mapbox-gl',
  'maplibre-gl',
  'p5',
  'paper',
  'pixi.js',
  'potree',
  'three',
  'three-bvh-csg',
  'vtk.js',
] as const;

// Globals a Compartment does not have. This is a vocabulary of names, not of
// capabilities: a reference confirmed unbound by the AST pass below means the
// module reads one of these off the ambient global object at evaluation time,
// which is precisely what a Capsule cannot supply.
const browserGlobals = [
  'CanvasRenderingContext2D',
  'HTMLCanvasElement',
  'HTMLElement',
  'MutationObserver',
  'ResizeObserver',
  'WebGL2RenderingContext',
  'WebGLRenderingContext',
  'customElements',
  'document',
  'localStorage',
  'navigator',
  'sessionStorage',
  'window',
] as const;

// Browser authority is often held by a value whose DOM type appears only in
// TypeScript syntax. `canvas.getContext()` is the canonical shape: stripping
// the `HTMLCanvasElement` annotation must not leave the executable member call
// looking Capsule-compatible, so the call itself is a signal independent of
// what the receiver is annotated as.
//
// Deliberately narrow. Every method here either acquires a browser rendering
// capability or operates on a live document-owned element in a way no data-only
// stand-in reproduces. A method that a plain object could plausibly also
// define does not belong: this list is matched by property name against any
// receiver, so a broad entry promotes cards that never touch the DOM.
const domOnlyMethods = [
  'getContext',
  'requestPointerLock',
  'setPointerCapture',
  'showModal',
  'toBlob',
  'toDataURL',
] as const;

/**
 * CSS that resolves a URL when the stylesheet is applied. A Capsule shares the
 * Host document, so such a declaration would issue a request with the viewer's
 * credentials from the Host's origin; the Capsule CSS policy refuses it at
 * admission. Classification routes it to the Sandbox ahead of that refusal, so
 * the card reaches a document where the declaration is actually supported
 * instead of rendering into a rejected stylesheet.
 *
 * Exported so the Capsule CSS policy and this classifier share one pattern
 * rather than each carrying a copy that can drift.
 */
export const networkBearingCSS =
  /(?:@import\b|(?:url|src|image|(?:-webkit-)?image-set|cross-fade|(?:-moz-)?element|paint)\s*\()/i;

// At-rules and properties whose effect is registered on the document rather
// than scoped to the element tree they appear in — a font family, a custom
// property definition, a named layer, a view-transition name. In a Capsule's
// shared document these would reach every other card on the page. `@layer`
// requires a name to match: a bare `@layer { … }` block is anonymous and
// scoped like any other rule.
const documentGlobalCSS =
  /(?:@(?:font-face|font-feature-values|font-palette-values|property|counter-style|color-profile|page|viewport|(?:-moz-)?document|namespace|view-transition|position-try|scroll-timeline|custom-media|custom-selector)\b|@layer\b(?!\s*\{)|\bview-transition-(?:name|class)\s*:)/i;

// Markup that paints in the document's top layer, which sits above the Host's
// own chrome and outside the element tree a Capsule renders into.
const topLayerAttribute =
  /\s(?:command|commandfor|popover|popovertarget|popovertargetaction)(?=\s|=|\/?>)/i;

// The one dynamic style expression a Capsule admits. `cssVar` is a trusted
// Boxel UI helper that produces custom-property declarations and nothing else,
// so it needs no browser global. It is named here as a bare mustache callee
// only: the Capsule evaluator independently verifies the reference resolved to
// the trusted Boxel UI module, so this is a routing convenience, never the
// check that makes the helper safe.
const capsuleSafeStyleHelper = 'cssVar';

// Template signal names, in the order they appear in a reason string.
const templateSignalNames = {
  dynamicInlineStyle: 'dynamic-inline-style',
  documentGlobalStyle: 'document-global-style',
  networkBearingStyle: 'network-bearing-style',
  globalStyleSelector: 'global-style-selector',
  topLayerMarkup: 'top-layer-markup',
  unscopedStyle: 'unscoped-style',
} as const;

const lexerReady = init;
const contentTagPreprocessor = new ContentTag.Preprocessor();
// The prefilter. A regex over masked source is cheap and runs on every module;
// the Babel parse that confirms what it finds is not, and runs only when it
// finds something. A hit here is a candidate, never a decision — an unscoped
// token match is exactly the false positive (a local variable named
// `document`, a DOM name in a type annotation) the confirmation pass exists to
// discard.
const browserGlobalPatterns = browserGlobals.map(
  (signal) => [signal, new RegExp(`\\b${signal}\\b`)] as const,
);
const domOnlyMethodPatterns = domOnlyMethods.map(
  (method) => [method, new RegExp(`\\.${method}\\s*\\(`)] as const,
);
const ambientGlobalObjectPattern = /\b(?:globalThis|self)\b/;

interface TemplateAnalysis {
  /** The source with every `<template>` body blanked, ready for the JS passes. */
  javascript: string;
  signals: string[];
}

/**
 * Reads the `<template>` blocks out of authored source and blanks their bodies,
 * so the JavaScript passes that follow see only JavaScript. Template syntax is
 * not JavaScript, and leaving it in place makes every module with a template
 * an unparseable draft.
 *
 * Blanking preserves character offsets and newlines, so a parse error reported
 * against the residue still names the authored line.
 */
function analyzeTemplates(source: string): TemplateAnalysis {
  let characters = Array.from(source);
  let found = new Set<string>();
  for (let match of contentTagPreprocessor.parse(source)) {
    let contents = match.contents;
    // An unquoted dynamic style attribute: `style={{someExpression}}`. Only
    // the bare trusted helper is admitted; every other expression computes a
    // declaration at render time, which a Capsule cannot validate ahead of
    // applying it.
    for (let style of contents.matchAll(/\sstyle\s*=\s*\{\{\s*([^\s}]+)/gi)) {
      if (style[1] !== capsuleSafeStyleHelper) {
        found.add(templateSignalNames.dynamicInlineStyle);
      }
    }
    // A QUOTED style attribute containing any interpolation —
    // `style='background: {{row.tone}}'` — compiles to a concatenation, never
    // to the bare helper invocation above, so it is dynamic whatever the
    // mustache holds.
    for (let style of contents.matchAll(/\sstyle\s*=\s*("[^"]*"|'[^']*')/gi)) {
      if (style[1].includes('{{')) {
        found.add(templateSignalNames.dynamicInlineStyle);
      }
    }
    for (let tag of contents.matchAll(/<[^>]+>/g)) {
      if (topLayerAttribute.test(tag[0])) {
        found.add(templateSignalNames.topLayerMarkup);
      }
    }
    // A `<style>` element without `scoped` is authored page-wide CSS. Scoped
    // CSS is extracted at build time and never reaches the document as an
    // element, so an element that survives here is asking for document scope.
    for (let styleTag of contents.matchAll(/<style(?=[\s>])([^>]*)>/gi)) {
      if (!/(?:^|\s)scoped(?=\s|=|$)/i.test(styleTag[1] ?? '')) {
        found.add(templateSignalNames.unscopedStyle);
      }
    }
    if (/:global\s*\(/i.test(contents)) {
      found.add(templateSignalNames.globalStyleSelector);
    }
    if (documentGlobalCSS.test(contents)) {
      found.add(templateSignalNames.documentGlobalStyle);
    }
    if (networkBearingCSS.test(contents)) {
      found.add(templateSignalNames.networkBearingStyle);
    }
    for (
      let index = match.range.startChar;
      index < match.range.endChar;
      index++
    ) {
      if (characters[index] !== '\n' && characters[index] !== '\r') {
        characters[index] = ' ';
      }
    }
  }
  return {
    javascript: characters.join(''),
    signals: Object.values(templateSignalNames).filter((name) =>
      found.has(name),
    ),
  };
}

/**
 * Blanks string and comment bodies, preserving offsets and line breaks, so the
 * prefilter reads code rather than prose. A module documenting `document` in a
 * comment, or holding the string `'window'`, requests no browser authority —
 * and without this the prefilter would trigger the confirmation parse on
 * nearly every module, giving up the reason the prefilter exists.
 */
function maskStringsAndComments(source: string): string {
  let output = Array.from(source);
  let quote: "'" | '"' | '`' | undefined;
  let lineComment = false;
  let blockComment = false;
  let escaped = false;

  for (let index = 0; index < output.length; index++) {
    let current = output[index]!;
    let next = output[index + 1];
    if (lineComment) {
      if (current === '\n') {
        lineComment = false;
      } else {
        output[index] = ' ';
      }
      continue;
    }
    if (blockComment) {
      if (current === '*' && next === '/') {
        output[index] = output[index + 1] = ' ';
        index++;
        blockComment = false;
      } else if (current !== '\n' && current !== '\r') {
        output[index] = ' ';
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (current === '\\') {
        escaped = true;
      } else if (current === quote) {
        quote = undefined;
      }
      if (current !== '\n' && current !== '\r') {
        output[index] = ' ';
      }
      continue;
    }
    if (current === '/' && next === '/') {
      output[index] = output[index + 1] = ' ';
      index++;
      lineComment = true;
    } else if (current === '/' && next === '*') {
      output[index] = output[index + 1] = ' ';
      index++;
      blockComment = true;
    } else if (current === "'" || current === '"' || current === '`') {
      quote = current;
      output[index] = ' ';
    }
  }
  return output.join('');
}

/**
 * Reduces a module identifier to the package name the browser-only vocabulary
 * is written against, so `three` matches however the module was reached: as a
 * bare specifier, through an `esm.sh` URL that carries a version suffix, or
 * from a realm that vendored it under a path.
 */
function packageName(moduleIdentifier: string): string {
  try {
    let url = new URL(moduleIdentifier);
    if (url.hostname === 'esm.sh') {
      let pathname = url.pathname.replace(/^\//, '').toLowerCase();
      // The version marker is the `@` that is not the scope's leading one.
      let versionMarker = pathname.indexOf(
        '@',
        pathname.startsWith('@') ? 1 : 0,
      );
      return versionMarker === -1 ? pathname : pathname.slice(0, versionMarker);
    }
    return `${url.hostname}${url.pathname}`.toLowerCase();
  } catch {
    return moduleIdentifier.toLowerCase();
  }
}

function browserOnlyPackageSignal(
  moduleIdentifier: string,
): string | undefined {
  let candidate = packageName(moduleIdentifier);
  return browserOnlyPackages.find(
    (signal) =>
      candidate === signal ||
      candidate.startsWith(`${signal}/`) ||
      candidate.includes(`/${signal}/`) ||
      candidate.includes(`/${signal}@`),
  );
}

/**
 * Whether the vocabulary already decides this module, which makes it a leaf of
 * the graph walk alongside the trusted modules.
 *
 * Walking into it can only add more browser evidence to a module already
 * promoted by naming it, so the answer is the same either way — and not
 * walking avoids trying to fetch authored source for a package the loader
 * serves as a bundle, which would otherwise report a load failure in place of
 * the far more useful signal the importer already carries. The identifier
 * stays in the module graph: it is still a module the Sandbox may read.
 */
export function isBrowserOnlyPackage(moduleIdentifier: string): boolean {
  return browserOnlyPackageSignal(moduleIdentifier) !== undefined;
}

/**
 * Confirms the prefilter's candidates against a scope-aware parse, returning
 * only the signals that survive.
 *
 * The parse strips TypeScript first: a DOM name in an interface, a type
 * annotation, or an `as HTMLElement` assertion requests no authority and must
 * not survive into the executable form. What remains is walked for identifier
 * references that resolve to no lexical binding — the definition of reading a
 * name off the ambient global object.
 *
 * A parse failure keeps the prefilter's unconfirmed candidates. That is the
 * conservative direction: unfamiliar or in-progress syntax cannot buy a module
 * the weaker cage by being unreadable.
 */
function confirmBrowserSignals(source: string): {
  globals: string[];
  domMethods: string[];
} {
  let masked = maskStringsAndComments(source);
  let candidateGlobals = browserGlobalPatterns
    .filter(([, pattern]) => pattern.test(masked))
    .map(([signal]) => signal);
  let candidateDOMMethods = domOnlyMethodPatterns
    .filter(([, pattern]) => pattern.test(source))
    .map(([method]) => method);
  let candidateGlobalObject = ambientGlobalObjectPattern.test(masked);
  if (
    candidateGlobals.length === 0 &&
    candidateDOMMethods.length === 0 &&
    !candidateGlobalObject
  ) {
    return { globals: [], domMethods: [] };
  }

  let unboundGlobals = new Set<string>();
  let domMethodCalls = new Set<string>();
  let isBrowserGlobal = (name: string): boolean =>
    browserGlobals.includes(name as (typeof browserGlobals)[number]);
  // `globalThis` and `self` reach the same ambient object a bare reference
  // does, so a member access on either is treated as a reference to the named
  // global — and an access this pass cannot name is attributed to `window`.
  // Attributing rather than ignoring is what closes the computed spellings
  // (`globalThis['doc' + 'ument']`, a rest element in a destructure) without
  // trying to evaluate every JavaScript constant expression.
  let recordAmbientProperty = (name: string | undefined) => {
    unboundGlobals.add(name && isBrowserGlobal(name) ? name : 'window');
  };
  let isAmbientGlobalObject = (
    node: babel.types.Node,
    scope: babel.NodePath['scope'],
  ): node is babel.types.Identifier =>
    babel.types.isIdentifier(node) &&
    (node.name === 'globalThis' || node.name === 'self') &&
    // A lexically bound `globalThis` — a parameter, a local — is ordinary
    // authored data that happens to share the name.
    scope.getBinding(node.name) === undefined;
  let staticPropertyName = (
    node: babel.types.Node,
    computed: boolean,
  ): string | undefined => {
    if (!computed && babel.types.isIdentifier(node)) {
      return node.name;
    }
    return computed && babel.types.isStringLiteral(node)
      ? node.value
      : undefined;
  };

  let collectBrowserSignals: babel.PluginObj = {
    visitor: {
      ReferencedIdentifier(path) {
        let name = path.node.name;
        if (
          !isBrowserGlobal(name) ||
          path.scope.getBinding(name) !== undefined
        ) {
          return;
        }
        // `typeof window` acquires no authority: on an unresolvable name it
        // evaluates to 'undefined' instead of throwing, so the standard
        // isomorphic guard (`typeof window !== 'undefined' && …`) runs
        // correctly inside a Compartment. Any other reference to the same
        // name — the guarded branch's actual use included — still signals.
        if (
          babel.types.isUnaryExpression(path.parent, { operator: 'typeof' }) &&
          path.parent.argument === path.node
        ) {
          return;
        }
        unboundGlobals.add(name);
      },
      CallExpression(path) {
        let callee = path.node.callee;
        if (
          babel.types.isMemberExpression(callee) &&
          !callee.computed &&
          babel.types.isIdentifier(callee.property) &&
          domOnlyMethods.includes(
            callee.property.name as (typeof domOnlyMethods)[number],
          )
        ) {
          domMethodCalls.add(callee.property.name);
        }
      },
      MemberExpression(path) {
        if (!isAmbientGlobalObject(path.node.object, path.scope)) {
          return;
        }
        recordAmbientProperty(
          staticPropertyName(path.node.property, path.node.computed),
        );
      },
      VariableDeclarator(path) {
        if (
          !babel.types.isObjectPattern(path.node.id) ||
          path.node.init == null ||
          !isAmbientGlobalObject(path.node.init, path.scope)
        ) {
          return;
        }
        for (let property of path.node.id.properties) {
          if (babel.types.isRestElement(property)) {
            recordAmbientProperty(undefined);
          } else if (babel.types.isObjectProperty(property)) {
            recordAmbientProperty(
              staticPropertyName(property.key, property.computed),
            );
          }
        }
      },
    },
  };

  try {
    babel.transformSync(source, {
      // `cwd`, `root` and `envName` are pinned because Babel otherwise reads
      // them off `process`: it resolves a relative `cwd` through
      // `process.cwd()` and defaults `envName` from `process.env.BABEL_ENV ||
      // process.env.NODE_ENV`. An absolute cwd and root skip that resolution,
      // and a given envName skips the lookup. A browser has no `process`
      // unless the page shims one, and this analysis should not depend on
      // whichever page it runs in: the fallback on a throw is the unconfirmed
      // prefilter, which over-promotes to Sandbox rather than reporting an
      // error, so an unmet ambient dependency here degrades silently instead
      // of failing a test.
      cwd: '/',
      root: '/',
      envName: 'production',
      filename: 'boxel-source.ts',
      babelrc: false,
      configFile: false,
      compact: true,
      plugins: [
        [typescriptPlugin, { allowDeclareFields: true }],
        collectBrowserSignals,
      ],
      parserOpts: { plugins: ['decorators-legacy'] },
    });
  } catch {
    return {
      globals: candidateGlobals,
      domMethods: candidateDOMMethods.map((method) => `dom-method:${method}`),
    };
  }
  return {
    // Filtered through the declared tables rather than emitted in discovery
    // order, so the signal list — and therefore the reason string — is a
    // canonical set that does not vary with where in the file a name appears.
    globals: browserGlobals.filter((signal) => unboundGlobals.has(signal)),
    domMethods: domOnlyMethods
      .filter((method) => domMethodCalls.has(method))
      .map((method) => `dom-method:${method}`),
  };
}

function parsePendingAnalysis(): BoxelSourceAnalysis {
  return {
    tier: 'capsule',
    reason: 'source-parse-pending',
    imports: [],
    signals: [],
    propagatesToImporters: false,
  };
}

/**
 * Analyzes ONE module's source. The code is never executed to classify it.
 *
 * The source must be as authored: template signals are read out of
 * `<template>` blocks, which a compiled artifact does not contain. Handing
 * compiled output to this function yields a classification built from its
 * imports and JavaScript alone. That direction is a smoothness cost rather
 * than a trust one — an unnoticed browser requirement lands in a Capsule,
 * where the Compartment has no `document` and the CSS policy refuses the
 * stylesheet, so the card fails visibly instead of escaping — but it is the
 * reason the graph walk is given authored source.
 */
export async function classifyBoxelSource(
  source: string,
): Promise<BoxelSourceAnalysis> {
  let templates: TemplateAnalysis;
  try {
    templates = analyzeTemplates(source);
  } catch {
    return parsePendingAnalysis();
  }

  await lexerReady;
  let imports: string[];
  try {
    // A dynamic import with a literal specifier carries `n` exactly as a
    // static one does, so it joins the graph as an ordinary edge and promotes
    // its importer up front. A computed specifier carries no `n` and is
    // dropped here: nothing static can authorize it, and both cages refuse it
    // at runtime.
    imports = [
      ...new Set(
        parse(templates.javascript)[0]
          .map((entry) => entry.n)
          .filter(
            (specifier): specifier is string => typeof specifier === 'string',
          ),
      ),
    ];
  } catch {
    return parsePendingAnalysis();
  }

  let importSignals = [
    ...new Set(
      imports
        .map(browserOnlyPackageSignal)
        .filter((signal): signal is string => signal !== undefined),
    ),
  ].sort();
  let { globals, domMethods } = confirmBrowserSignals(templates.javascript);
  let signals = [
    ...importSignals,
    ...globals,
    ...domMethods,
    ...templates.signals,
  ];
  if (signals.length === 0) {
    return {
      tier: 'capsule',
      reason: 'default-user-card',
      imports,
      signals: [],
      propagatesToImporters: false,
    };
  }
  return {
    tier: 'sandbox',
    reason: `browser-runtime:${signals.join(',')}`,
    imports,
    signals,
    propagatesToImporters:
      importSignals.length > 0 ||
      domMethods.length > 0 ||
      templates.signals.length > 0,
  };
}

export interface BoxelModuleGraphClassifierOptions {
  loadSource(moduleIdentifier: string): Promise<string>;
  resolveImport(specifier: string, relativeTo: string): string;
  isTrustedModule(moduleIdentifier: string): boolean;
  /**
   * The number of authored modules one walk will analyze. Trusted leaves do
   * not count against it, since they are never fetched or analyzed.
   */
  maxModules?: number;
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

// The reason kinds that describe something classification could not
// establish, rather than something it found. A result carrying one is not
// memoized at the entry level: the next request re-walks instead of pinning a
// transient fetch failure or an in-progress draft.
const transientReasonKinds = new Set([
  'source-parse-pending',
  'module-load',
  'module-resolve',
  'module-analysis',
  'module-graph-limit',
]);

function isTransientReason(reason: string): boolean {
  return transientReasonKinds.has(reason.split(':')[0]!);
}

interface ModuleAnalysis {
  sourceHash: string;
  analysis: BoxelSourceAnalysis;
  /** Resolved dependency identifiers, deduplicated and sorted. */
  dependencies: string[];
}

/**
 * Classifies an authored module graph — the entry module and everything
 * reachable from it — rather than only the entry file.
 *
 * Trusted modules are the graph's leaves: Host code carries no authored
 * evidence, so it is neither fetched nor analyzed and its own imports are not
 * followed. An authored dependency whose evidence propagates promotes the
 * entry (see `propagatesToImporters`). A dependency that cannot be resolved or
 * loaded, and a graph that outgrows its bound, fail the whole result closed to
 * Sandbox with a diagnostic reason.
 *
 * Two caches, both invalidated together:
 *
 *   - a per-MODULE memo keyed by a hash of the module's source, shared across
 *     every entry. Two cards sharing a dependency subtree analyze it once, and
 *     the second card fetches none of it.
 *   - a per-ENTRY memo of the finished classification, which records the graph
 *     it was computed from so invalidating any member evicts it.
 *
 * `invalidate(module)` evicts that module's analysis and every entry whose
 * graph contains it. A failed classification is never memoized, so the next
 * request retries rather than pinning a transient fetch failure.
 */
export class BoxelModuleGraphClassifier {
  // Promises rather than values, so entries walking concurrently share one
  // fetch and one analysis of a module they both reach.
  private moduleAnalyses = new Map<string, Promise<ModuleAnalysis>>();
  private entries = new Map<
    string,
    {
      classification: Promise<BoxelSourceClassification>;
      /** Set when the caller supplied source; absent when it was fetched. */
      sourceHash?: string;
      /** Every identifier the walk reached, so invalidation can find it. */
      graph: Set<string>;
    }
  >();

  constructor(private readonly options: BoxelModuleGraphClassifierOptions) {}

  /**
   * Classifies `moduleIdentifier` and its reachable graph. Pass `source` to
   * classify a revision the loader cannot fetch — an unsaved draft — in which
   * case the entry memo is keyed by that source's hash and a changed draft
   * replaces it.
   *
   * The entry module is always analyzed, even when it is itself trusted: "is
   * this module Host-owned" is rule R1's question, answered by the caller
   * ahead of asking this one, and keeping the two separate means the trusted
   * test has exactly one meaning here — prune this dependency edge.
   */
  classifyModuleGraph(
    moduleIdentifier: string,
    source?: string,
  ): Promise<BoxelSourceClassification> {
    let sourceHash = source === undefined ? undefined : hashSource(source);
    let existing = this.entries.get(moduleIdentifier);
    if (existing && existing.sourceHash === sourceHash) {
      return existing.classification;
    }
    let graph = new Set<string>([moduleIdentifier]);
    let classification = this.walkGraph(moduleIdentifier, source, graph);
    let entry = { classification, sourceHash, graph };
    this.entries.set(moduleIdentifier, entry);
    let evict = () => {
      if (this.entries.get(moduleIdentifier) === entry) {
        this.entries.delete(moduleIdentifier);
      }
    };
    // A result that reports what could not be established is not an answer to
    // keep: the module may load next time, the draft may parse next time. The
    // eviction reads the resolved value rather than only catching a rejection,
    // because the walk reports such a result rather than throwing it.
    void classification.then(
      ({ reason }) => (isTransientReason(reason) ? evict() : undefined),
      evict,
    );
    return classification;
  }

  /**
   * Drops cached work. With a module identifier, that is the module's own
   * analysis plus every entry whose graph reached it — an entry's tier can turn
   * on a dependency's evidence, so a stale importer is as wrong as a stale
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
    graph: Set<string>,
  ): Promise<BoxelSourceClassification> {
    let maxModules = this.options.maxModules ?? 256;
    // The complete reachable graph is collected BEFORE any promotion is
    // computed. Promotion then reads a finished map, so a diamond reached from
    // either side and a cycle entered at either end produce the same answer:
    // traversal order cannot reach the decision.
    let analyzed = new Map<string, ModuleAnalysis>();
    let failures: string[] = [];
    let exceededLimit = false;
    let queue: { identifier: string; suppliedSource?: string }[] = [
      { identifier: moduleIdentifier, suppliedSource: entrySource },
    ];

    while (queue.length > 0) {
      let { identifier, suppliedSource } = queue.shift()!;
      if (analyzed.has(identifier)) {
        continue;
      }
      if (analyzed.size >= maxModules) {
        exceededLimit = true;
        break;
      }
      let analysis: ModuleAnalysis;
      try {
        analysis = await this.analyzeModule(identifier, suppliedSource);
      } catch (error) {
        failures.push(
          ...(error instanceof ModuleGraphFailure
            ? error.reasons
            : [`module-analysis:${identifier}`]),
        );
        continue;
      }
      analyzed.set(identifier, analysis);
      for (let dependency of analysis.dependencies) {
        graph.add(dependency);
        // Trusted modules and already-recognized browser-only packages are
        // leaves: nothing their source could say would change the answer.
        if (
          !this.options.isTrustedModule(dependency) &&
          !isBrowserOnlyPackage(dependency)
        ) {
          queue.push({ identifier: dependency });
        }
      }
    }

    let moduleGraph = [
      moduleIdentifier,
      ...[...graph]
        .filter((identifier) => identifier !== moduleIdentifier)
        .sort(),
    ];
    // Sorted, so a reported failure is a property of the graph rather than of
    // the order the walk happened to reach its members in. The bound comes
    // first: once it is hit the walk stopped early, so which OTHER modules
    // failed is an artifact of where it stopped.
    let failureReason = (): string =>
      exceededLimit ? 'module-graph-limit' : failures.sort()[0]!;

    // The entry's own analysis is where every other question starts: nothing
    // was enqueued until it succeeded, so if it failed the graph holds nothing
    // to weigh against the failure.
    let root = analyzed.get(moduleIdentifier)?.analysis;
    if (!root) {
      return { ...failedClassification(failureReason()), moduleGraph };
    }

    // Positive evidence is reported ahead of any failure. Both reach Sandbox,
    // so precedence is chosen for what the diagnostic tells an author: "this
    // card imports three" is actionable, and "a module in its graph did not
    // load" — true of the same graph, of a package the loader was never going
    // to serve as source — is not. A failure decides the result only when
    // there is no positive evidence, which is exactly when an incomplete graph
    // could otherwise be mistaken for a clean one.
    if (root.tier === 'sandbox') {
      return { ...root, moduleGraph };
    }
    // Sorted by identifier with a plain comparison rather than
    // `localeCompare`, which is locale-dependent and would let the reported
    // dependency vary between two browsers looking at the same graph.
    let propagating = [...analyzed]
      .filter(([identifier]) => identifier !== moduleIdentifier)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .find(
        ([, { analysis }]) =>
          analysis.tier === 'sandbox' && analysis.propagatesToImporters,
      );
    if (propagating) {
      let [dependencyIdentifier, { analysis: dependency }] = propagating;
      return {
        tier: 'sandbox',
        reason: `dependency-runtime:${dependencyIdentifier}`,
        // The entry's own imports, not the dependency's: `imports` describes
        // the module this result is about.
        imports: root.imports,
        signals: dependency.signals,
        propagatesToImporters: true,
        moduleGraph,
      };
    }
    if (exceededLimit || failures.length > 0) {
      return { ...failedClassification(failureReason()), moduleGraph };
    }
    return { ...root, moduleGraph };
  }

  /**
   * Returns one module's analysis, from the shared memo when it holds a
   * current one.
   *
   * With no supplied source the memo is authoritative and nothing is fetched —
   * that is what lets a second entry traverse a shared subtree for free. A
   * supplied source is compared by hash instead, so an unchanged draft reuses
   * the memo and a changed one replaces it.
   */
  private async analyzeModule(
    moduleIdentifier: string,
    suppliedSource?: string,
  ): Promise<ModuleAnalysis> {
    let pending = this.moduleAnalyses.get(moduleIdentifier);
    if (pending) {
      // A rejection propagates to this caller rather than being retried
      // mid-walk: the module already self-evicted, so the retry is the next
      // classification, and this walk fails closed as it should.
      let memo = await pending;
      if (
        suppliedSource === undefined ||
        memo.sourceHash === hashSource(suppliedSource)
      ) {
        return memo;
      }
      if (this.moduleAnalyses.get(moduleIdentifier) === pending) {
        this.moduleAnalyses.delete(moduleIdentifier);
      }
    }
    let fresh = this.freshAnalysis(moduleIdentifier, suppliedSource);
    // One revision per module: a later supplied source replaces an earlier
    // one, matching the memo's meaning of "what this module currently is".
    this.moduleAnalyses.set(moduleIdentifier, fresh);
    void fresh.catch(() => {
      if (this.moduleAnalyses.get(moduleIdentifier) === fresh) {
        this.moduleAnalyses.delete(moduleIdentifier);
      }
    });
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
    let analysis = await classifyBoxelSource(source);
    let dependencies = new Set<string>();
    let unresolved: string[] = [];
    for (let specifier of analysis.imports) {
      // A trusted specifier is already a canonical leaf, so it is recorded
      // without being resolved. Resolving one can evaluate the trusted module
      // merely to discover its URL — an async package shim does exactly that —
      // which would turn classification into an eager module load and pull in
      // that module's own transitive network dependencies. The runtime
      // resolves the reference only if authored code actually uses the export.
      if (this.options.isTrustedModule(specifier)) {
        dependencies.add(specifier);
        continue;
      }
      try {
        dependencies.add(
          this.options.resolveImport(specifier, moduleIdentifier),
        );
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
    return {
      sourceHash: hashSource(source),
      analysis,
      dependencies: [...dependencies].sort(),
    };
  }
}

function failedClassification(reason: string): BoxelSourceClassification {
  return {
    tier: 'sandbox',
    reason,
    imports: [],
    signals: [reason],
    // A graph we could not establish is not a graph we can vouch for on an
    // importer's behalf either.
    propagatesToImporters: true,
    moduleGraph: [],
  };
}

/**
 * A cache key for a module's source text.
 *
 * FNV-1a over two lanes with different multipliers, folded to one hexadecimal
 * key. It is not a cryptographic digest and does not need to be: a collision
 * would let a changed module reuse the previous revision's classification,
 * which costs the wrong CAGE — a Capsule where a Sandbox was wanted, or the
 * reverse. Neither is a trust failure. Whether code is Host-owned is decided
 * by `isTrustedModule` from the module's URL, which no cache participates in,
 * so no hash outcome can move authored code to Direct. Nor is there anything
 * to win by forcing a collision: an author who wants the Capsule can simply
 * write code with no browser signals in it.
 *
 * Synchronous by requirement — this runs inside the walk, where the async
 * digest APIs would make every memo lookup a microtask.
 */
function hashSource(source: string): string {
  let low = 0x811c9dc5;
  let high = 0x01000193;
  for (let index = 0; index < source.length; index++) {
    let code = source.charCodeAt(index);
    low = Math.imul(low ^ code, 0x01000193);
    high = Math.imul(high ^ code, 0x85ebca6b);
  }
  // The length is mixed in so two sources differing only past the point where
  // both lanes happen to converge still differ.
  return `${(low >>> 0).toString(16)}-${(high >>> 0).toString(16)}-${source.length.toString(16)}`;
}
