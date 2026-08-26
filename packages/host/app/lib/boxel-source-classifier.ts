import * as babel from '@babel/core';
// @ts-ignore no upstream types are available
import typescriptPlugin from '@babel/plugin-transform-typescript';
import * as ContentTag from 'content-tag';

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
 * first `:` — the kind is the whole string for the three that carry no
 * payload, and the prefix for the rest.
 *
 *   `default-user-card`             authored code with no browser evidence
 *   `source-parse-pending`          source did not parse (see below)
 *   `browser-runtime:<signals>`     the module's own signals, comma-separated
 *   `dependency-runtime:<url>`      a dependency's signals propagated up
 *   `module-load:<url>`             a graph member's source did not load
 *   `module-parse:<url>`            a DEPENDENCY's source did not parse
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
  'module-parse',
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
   * that surface, so it needs the same browser authority.
   *
   * A global REFERENCE splits on when it is evaluated. One read at module
   * initialization — `export const title = document.title` — runs the moment
   * an importer loads the module, so the importer needs the same authority and
   * is promoted. One inside a function body may never run at all: a library
   * routinely carries a browser adapter this graph never calls, and promoting
   * every importer for a dormant reference costs an iframe to cards that would
   * otherwise render in a Capsule. A dormant reference still promotes the
   * module that contains it, where the read would be evaluated.
   */
  propagatesToImporters: boolean;
}

/** One authored module graph's classification. */
export interface BoxelSourceClassification extends BoxelSourceAnalysis {
  /**
   * Every module identifier the walk reached, entry first and the rest sorted.
   * This is the exact set a stronger runtime may read: a Sandbox authorizes a
   * module fetch against it before any authenticated request fires.
   *
   * Complete only when `moduleGraphComplete` says so. The reason string is NOT
   * that signal: positive evidence is reported ahead of a failure in the same
   * graph, so a settled-looking `browser-runtime:…` can accompany a list that
   * stops where an unreadable member did.
   */
  moduleGraph: string[];

  /**
   * Whether the walk read every module it reached. When false, `moduleGraph` is
   * whatever it got to before something could not be loaded, parsed, resolved,
   * or fitted inside the bound — so it is a diagnostic, not an authorization
   * list, and a runtime that checked fetches against it would refuse reads the
   * render needs. Such a result is never memoized, so the caller's move is to
   * classify again rather than to authorize against it.
   */
  moduleGraphComplete: boolean;
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
 * credentials from the Host's origin. Classification routes it to the Sandbox,
 * where the card gets a document of its own and the declaration is actually
 * supported.
 *
 * Exported because the Capsule's CSS admission check needs the same notion of
 * network-bearing, and two copies of a pattern this fiddly would drift.
 *
 * The leading `(?:^|[^\w-])` is what keeps a function name from matching
 * inside a longer identifier: without it `thumbnailUrl(` reads as `url(` and
 * `createElement(` as `element(`, each costing a card an iframe. It admits a
 * hyphen-prefixed vendor form, so `-webkit-image-set(` still matches.
 */
export const networkBearingCSS =
  /(?:@import\b|(?:^|[^\w-])(?:url|src|image|(?:-webkit-)?image-set|cross-fade|(?:-moz-)?element|paint)\s*\()/i;

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

const contentTagPreprocessor = new ContentTag.Preprocessor();

// Shared by the parse and the transform, so the two cannot drift apart.
//
// `cwd`, `root` and `envName` are pinned because Babel otherwise reads them off
// `process`: it resolves a relative `cwd` through `process.cwd()` and defaults
// `envName` from `process.env.BABEL_ENV || process.env.NODE_ENV`. An absolute
// cwd and root skip that resolution, and a given envName skips the lookup. A
// browser has no `process` unless the page shims one, and this analysis should
// not depend on whichever page it runs in.
const pinnedBabelOptions = {
  cwd: '/',
  root: '/',
  envName: 'production',
  filename: 'boxel-source.gts',
  babelrc: false,
  configFile: false,
} as const;

/**
 * The accept-set: the syntax a Boxel module may use and still be read as
 * itself here. It is not chosen, it is MIRRORED — a module the realm serves
 * but this parse refuses is reported `source-parse-pending`, an unfinished
 * draft, which classifies it Capsule with no signals at all. That direction is
 * right for a genuine draft and wrong for working code, and its only symptom
 * is a card rendering in the wrong cage.
 *
 * What is being mirrored is `transpile.ts`'s `realmBabelPlugins`. A Babel
 * plugin widens the parser only through `manipulateOptions`, and exactly two
 * of the realm's plugins do: this same TypeScript plugin, contributing
 * `typescript` (along with `objectRestSpread` and `classProperties`), and
 * `decorator-transforms`, contributing `decorators-legacy`. The rest — the
 * template compiler, scoped CSS, the concurrency and loader plugins — carry no
 * syntax. So `decorators-legacy` is here because `decorator-transforms` puts
 * it there, and moving the realm to a different decorator proposal has to move
 * this too.
 *
 * Nothing about that reasoning is self-enforcing, which is why it is exported
 * rather than written inline: `RP-6.4: the parser accept-set is the realm's,
 * plugin for plugin` drives Babel over both lists and compares what each
 * contributes, so a plugin added to the realm's pipeline fails a comparison
 * instead of quietly serving syntax this file cannot read.
 *
 * A function, not a constant, because Babel appends every plugin's
 * contribution to the very `parserOpts.plugins` array it is handed — a shared
 * one would accumulate `typescript` once per parse and report an accept-set
 * that grows with use.
 */
export function sourceParseOptions(): {
  plugins: babel.PluginItem[];
  parserOpts: NonNullable<babel.TransformOptions['parserOpts']>;
} {
  return {
    plugins: [[typescriptPlugin, { allowDeclareFields: true }]],
    parserOpts: { plugins: ['decorators-legacy'] },
  };
}

// The one import content-tag adds to a module that contains a template, to
// compile the blocks it replaced. It is not an authored edge, so it is not a
// graph member — and it is named here rather than pattern-matched so a
// content-tag upgrade that renames it fails a test instead of quietly adding a
// module to every templated card's graph.
const templateCompilerModule = '@ember/template-compiler';
// The template signals below are matched against a `<template>` block's whole
// body — markup, text nodes, attribute values and `<style>` contents alike —
// rather than against a parsed tree. That is why each one over-reports: a
// class named `popover`, an email address containing `@page`, or the literal
// text `url(` in a text node all read as their signal. Every such miss costs
// an unnecessary iframe and never a lost one, which is the affordable
// direction; narrowing them means parsing the template here, which is the
// admission check's job rather than the router's.
interface TemplateAnalysis {
  signals: string[];
}

/**
 * Reads the signals carried by the `<template>` blocks in authored source.
 *
 * Only the blocks' own text is examined here. The surrounding JavaScript is
 * read separately, from the form content-tag compiles this source into, so
 * nothing in this function has to leave behind something that parses.
 */
function analyzeTemplates(source: string): TemplateAnalysis {
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
  }
  return {
    signals: Object.values(templateSignalNames).filter((name) =>
      found.has(name),
    ),
  };
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
 * Whether the vocabulary already decides this module AND the loader serves it
 * as a bundle rather than as authored source — which together make it a leaf
 * of the graph walk, alongside the trusted modules. The identifier still
 * enters the module graph: it is a module the Sandbox may read.
 *
 * Both halves are load-bearing. Walking into a real package can only add
 * browser evidence to a module already promoted by naming it, and not walking
 * avoids trying to fetch authored source for something served as a bundle,
 * which would report a load failure in place of the far more useful signal the
 * importer already carries.
 *
 * Every other URL is walked, which is wider than the case that motivates it: a
 * realm-hosted module under a path segment named `three` or `paper` should
 * promote its importer AND contribute its own dependencies, because those are
 * separate modules the realm serves and a Sandbox authorizes reads against
 * exactly `moduleGraph` — pruning them makes the render fail on a refused
 * fetch rather than merely cost an iframe. A bundle served from some other CDN
 * is walked too, and costs a fetch and a parse that tell us nothing. Narrowing
 * that means a list of CDN hosts, which is a worse thing to maintain than one
 * redundant fetch.
 */
function isBundledBrowserOnlyPackage(moduleIdentifier: string): boolean {
  if (browserOnlyPackageSignal(moduleIdentifier) === undefined) {
    return false;
  }
  try {
    return new URL(moduleIdentifier).hostname === 'esm.sh';
  } catch {
    // Not a URL, so a bare specifier the loader resolves to a package.
    return true;
  }
}

/**
 * Whether the TypeScript transform deletes this declaration outright, so that
 * it names no module the loader will ever be asked for.
 *
 * Read from the parser's own marking rather than from the statement's text.
 * `importKind`/`exportKind` is `'type'` for a whole-declaration modifier
 * (`import type { Scene }`, `import type * as T`, `import type Scene`), and
 * each named specifier carries its own kind for the inline form
 * (`import { type Scene }`). A declaration is erased when it introduces
 * bindings and every one of them is type-only.
 *
 * The two failure directions are not symmetric — missing an erased statement
 * costs a fetch and an iframe, while reporting a live one as erased loses a
 * signal and truncates the graph a Sandbox authorizes reads against — which is
 * why this reads a classification the parser already made instead of matching
 * the keyword itself. A default or namespace binding carries no kind and is
 * always a value, so `import type from 'three'` and `import types from
 * 'three'` are edges, and no boundary has to be got right for them to be.
 */
function isErasedDeclaration(
  statement:
    | babel.types.ImportDeclaration
    | babel.types.ExportNamedDeclaration
    | babel.types.ExportAllDeclaration,
): boolean {
  if (
    ('importKind' in statement && statement.importKind === 'type') ||
    ('exportKind' in statement && statement.exportKind === 'type')
  ) {
    return true;
  }
  let specifiers = 'specifiers' in statement ? statement.specifiers : [];
  // No bindings at all is a side-effect import, which always runs.
  if (specifiers.length === 0) {
    return false;
  }
  return specifiers.every((specifier) => {
    if (babel.types.isImportSpecifier(specifier)) {
      return specifier.importKind === 'type';
    }
    if (babel.types.isExportSpecifier(specifier)) {
      return specifier.exportKind === 'type';
    }
    // A default or namespace binding carries no kind, and is always a value.
    return false;
  });
}

/**
 * The specifier of a dynamic import, when it is knowable without running
 * anything: a string literal, or a template literal with no interpolation.
 */
function staticSpecifier(
  argument: babel.types.Node | undefined,
): string | undefined {
  if (babel.types.isStringLiteral(argument)) {
    return argument.value;
  }
  if (
    babel.types.isTemplateLiteral(argument) &&
    argument.expressions.length === 0 &&
    argument.quasis.length === 1
  ) {
    return argument.quasis[0]!.value.cooked;
  }
  return undefined;
}

/**
 * Reads one module's JavaScript: the modules it imports at runtime, and the
 * browser authority it acquires.
 *
 * Both answers come from one parse of the source, because both are questions
 * about its syntax rather than about its text. Type-only imports are marked by
 * the parser, so nothing here has to recognize them from their spelling. And
 * the scope-aware walk is what separates an ambient `document` from a local
 * binding of the same name, a DOM name that survives only in a type
 * annotation, and a `typeof window` probe.
 *
 * Every module pays the parse. The alternative — a regex prefilter that skips
 * it when the text names no browser global — makes the prefilter a GATE, and a
 * gate that mis-reads one span of a module loses a SIGNAL rather than accuracy.
 * Deciding which spans are code means lexing JavaScript, where each
 * approximation has an input that desynchronizes it and swallows the rest of
 * the file. A parse cannot fail that way, and a module fetch costs more than it
 * does.
 *
 * A parse has its own total-loss mode, though, which is why the caller feeds it
 * the same front-end the realm compiles with: everything is lost when the parse
 * is refused, so its accept-set has to be the realm's. Anything narrower reads
 * a servable module as a draft and classifies it Capsule with no signals at
 * all — worse than the desynchronization it replaced, because it takes the
 * template signals with it.
 */
function analyzeJavaScript(source: string): {
  /**
   * Specifiers that survive to runtime, in source order. A statement the
   * TypeScript transform erases entirely is absent: it names no module the
   * loader will ever be asked for.
   */
  imports: string[];
  globals: string[];
  domMethods: string[];
  /**
   * Whether any confirmed global reference is evaluated when the module is
   * initialized, rather than inside a function body that may never be called.
   * An eager read is what makes a dependency's requirement its importer's
   * requirement: importing the module runs it.
   */
  hasEagerGlobal: boolean;
} {
  let ast = babel.parseSync(source, {
    ...pinnedBabelOptions,
    ...sourceParseOptions(),
  });
  if (!ast) {
    throw new Error('the parser returned no AST');
  }

  // Read the import graph off the top-level statements before anything
  // transforms them. The TypeScript transform below would answer this too, by
  // deleting what it erases — but it also deletes an import whose bindings are
  // unused, and in content-tag's output a template is a string literal, so a
  // component imported only for its template is exactly that. Dropping it would
  // lose the most ordinary edge a card has. Type-ness is read from the parser's
  // own marking instead, which says nothing about use.
  let imports: string[] = [];
  for (let statement of ast.program.body) {
    if (
      !babel.types.isImportDeclaration(statement) &&
      !babel.types.isExportNamedDeclaration(statement) &&
      !babel.types.isExportAllDeclaration(statement)
    ) {
      continue;
    }
    if (!statement.source) {
      continue;
    }
    if (
      statement.source.value !== templateCompilerModule &&
      !isErasedDeclaration(statement)
    ) {
      imports.push(statement.source.value);
    }
  }

  let unboundGlobals = new Set<string>();
  let eagerGlobals = false;
  // A reference is evaluated at module initialization unless it sits inside a
  // function body or a non-static class field. Both of those run only when
  // something calls or constructs them, which importing the module does not.
  //
  // The approximation errs toward "deferred" in one shape: an
  // immediately-invoked function expression at the top level does run on
  // import, but reads as deferred here. Recognizing it means deciding which
  // functions are called immediately, which is not a question static analysis
  // answers in general — and the cost of being wrong is the module's importer
  // staying in a Capsule that the module then needs a browser inside, which
  // fails visibly there.
  let isEager = (path: babel.NodePath): boolean => {
    let child: babel.NodePath = path;
    for (
      let ancestor = path.parentPath;
      ancestor !== null;
      child = ancestor, ancestor = ancestor.parentPath
    ) {
      // A computed member key and a decorator argument are evaluated when the
      // declaration they sit on is evaluated, never when its body runs — so
      // they are not deferred by the member that carries them, and the walk
      // continues outward to decide.
      if (child.key === 'key' || child.listKey === 'decorators') {
        continue;
      }
      if (ancestor.isFunction()) {
        return false;
      }
      // A non-static field's VALUE runs at construction, so it defers. A
      // static field's runs when the class is defined, which for a top-level
      // class is module initialization.
      if (
        (ancestor.isClassProperty() || ancestor.isClassPrivateProperty()) &&
        !ancestor.node.static &&
        child.key === 'value'
      ) {
        return false;
      }
    }
    return true;
  };
  let domMethodCalls = new Set<string>();
  let isBrowserGlobal = (name: string): boolean =>
    browserGlobals.includes(name as (typeof browserGlobals)[number]);
  // `globalThis` and `self` reach the same ambient object a bare reference
  // does, so a member access on either is treated as a reference to the named
  // global — and an access this pass cannot name is attributed to `window`.
  // Attributing rather than ignoring is what closes the computed spellings
  // (`globalThis['doc' + 'ument']`, a rest element in a destructure) without
  // trying to evaluate every JavaScript constant expression.
  let recordAmbientProperty = (
    name: string | undefined,
    path: babel.NodePath,
  ) => {
    unboundGlobals.add(name && isBrowserGlobal(name) ? name : 'window');
    eagerGlobals ||= isEager(path);
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
        eagerGlobals ||= isEager(path);
      },
      CallExpression(path) {
        let callee = path.node.callee;
        // `import('three')` joins the graph as an ordinary edge, so it
        // promotes its importer up front rather than at runtime. A
        // no-substitution template literal is just as knowable and counts too;
        // anything computed cannot be statically authorized, and both cages
        // refuse it at runtime.
        if (babel.types.isImport(callee)) {
          let specifier = staticSpecifier(path.node.arguments[0]);
          if (specifier !== undefined) {
            imports.push(specifier);
          }
          return;
        }
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
          path,
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
            recordAmbientProperty(undefined, path);
          } else if (babel.types.isObjectProperty(property)) {
            recordAmbientProperty(
              staticPropertyName(property.key, property.computed),
              path,
            );
          }
        }
      },
    },
  };

  // Transformed from the AST already parsed above, so the source is read once.
  // The TypeScript strip has to run before the walk: a DOM name in an
  // interface, an annotation, or an `as HTMLElement` assertion acquires
  // nothing, and must not survive into the form that gets walked.
  babel.transformFromAstSync(ast, source, {
    ...pinnedBabelOptions,
    // Only the traverse is wanted; nothing reads generated code.
    code: false,
    cloneInputAst: false,
    plugins: [...sourceParseOptions().plugins, collectBrowserSignals],
  });

  return {
    imports,
    // Filtered through the declared tables rather than emitted in discovery
    // order, so the signal list — and therefore the reason string — is a
    // canonical set that does not vary with where in the file a name appears.
    globals: browserGlobals.filter((signal) => unboundGlobals.has(signal)),
    domMethods: domOnlyMethods
      .filter((method) => domMethodCalls.has(method))
      .map((method) => `dom-method:${method}`),
    hasEagerGlobal: eagerGlobals,
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
  let javascript: ReturnType<typeof analyzeJavaScript>;
  try {
    templates = analyzeTemplates(source);
    // The JavaScript that gets analyzed is the JavaScript the REALM compiles:
    // content-tag's output, parsed by Babel's own parser with the same
    // TypeScript plugin (`transpile.ts`). Matching that front-end is what makes
    // "the parser rejected this" mean "a draft" rather than "syntax the realm
    // serves and this file cannot read".
    //
    // Blanking the `<template>` spans instead would be shorter and is wrong: it
    // leaves valid JavaScript only where a template is a class member. In
    // expression position — `const Row = <template>…</template>;`, the dominant
    // idiom — it leaves a hole where an expression has to be, so a finished,
    // servable module reads as unparseable. content-tag replaces each block
    // with a compiler call, which parses in both positions.
    //
    // What keeps a component imported only for its template from vanishing is
    // not anything about that call: it is that imports are read off the parsed
    // statements before any transform touches them. In content-tag's output the
    // template is a string, so such a binding IS unused, and a transform would
    // drop it.
    javascript = analyzeJavaScript(
      contentTagPreprocessor.process(source, { filename: 'boxel-source.gts' })
        .code,
    );
  } catch {
    // Source this front-end rejects is source the realm cannot serve either,
    // which makes it a draft: the entry renders Capsule behind its last good
    // render, and a DEPENDENCY fails closed on `module-parse:`, because an
    // unproven closure is not a Capsule.
    return parsePendingAnalysis();
  }
  let imports = [...new Set(javascript.imports)];

  let importSignals = [
    ...new Set(
      imports
        .map(browserOnlyPackageSignal)
        .filter((signal): signal is string => signal !== undefined),
    ),
  ].sort();
  let { globals, domMethods, hasEagerGlobal } = javascript;
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
      templates.signals.length > 0 ||
      hasEagerGlobal,
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
// memoized at either level — the module's own analysis, or the entry's
// classification — so the next request re-reads instead of pinning a transient
// fetch failure or an in-progress draft.
const transientReasonKinds = new Set([
  'source-parse-pending',
  'module-load',
  'module-parse',
  'module-resolve',
  'module-analysis',
  'module-graph-limit',
]);

function isTransientReason(reason: string): boolean {
  return transientReasonKinds.has(reason.split(':')[0]!);
}

interface ModuleAnalysis {
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
 *   - a per-MODULE memo keyed by module identifier, shared across every entry.
 *     Two cards sharing a dependency subtree analyze it once, and the second
 *     card fetches none of it. It holds only what the loader served, never a
 *     caller's draft.
 *   - a per-ENTRY memo of the finished classification, which records the graph
 *     it was computed from so invalidating any member evicts it.
 *
 * `invalidate(module)` evicts that module's analysis and every entry whose
 * graph contains it. A failed classification is never memoized, so the next
 * request retries rather than pinning a transient fetch failure.
 *
 * Neither cache has a size bound: both hold what they are told about until
 * `invalidate` drops it, since the invalidation signal is the realm's and
 * arrives per changed module rather than under memory pressure. `maxModules`
 * bounds one WALK, not the caches. A holder that outlives many module graphs
 * wants `invalidate()` at whatever point its own module identities stop being
 * meaningful — a loader reset, a session ending.
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
   * classify a revision the loader cannot fetch — an unsaved draft. Such a
   * result is keyed by that source's hash and answers only this caller: a
   * draft never enters the memo other entries read, so it cannot decide a card
   * it is not the source of.
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
    // The walk fills both fields as it goes: `graph` so invalidation can find
    // this entry by any member, and `incomplete` so a result computed over a
    // graph the walk could not establish is not kept as an answer.
    let walk = {
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
    // A result that reports what could not be established is not an answer to
    // keep: the module may load next time, the draft may parse next time. The
    // eviction reads the resolved value rather than only catching a rejection,
    // because the walk reports such a result rather than throwing it.
    //
    // An incomplete walk counts even when the reported reason looks settled: a
    // module the walk could not read contributes no imports and no signals, so
    // both the tier and the module graph were drawn over a hole — and
    // `moduleGraph` is a read-authorization list, so a truncated one means a
    // refused fetch, not merely a stale tier.
    void classification.then(
      ({ reason }) =>
        isTransientReason(reason) || walk.incomplete ? evict() : undefined,
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
    walk: { graph: Set<string>; incomplete: boolean },
  ): Promise<BoxelSourceClassification> {
    let graph = walk.graph;
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
        walk.incomplete = true;
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
        walk.incomplete = true;
        continue;
      }
      analyzed.set(identifier, analysis);
      // The entry's own draft may sit mid-edit and still classify Capsule — a
      // dependency's may not. Nothing established that module's imports or its
      // signals, so its closure is unproven, which RP-6.1 R2 fails closed.
      //
      // Either way the walk did not establish the graph, so the result is not
      // an authorization list and is not kept: an entry that did not parse
      // reached none of its own dependencies.
      if (analysis.analysis.reason === 'source-parse-pending') {
        walk.incomplete = true;
        if (identifier !== moduleIdentifier) {
          failures.push(`module-parse:${identifier}`);
        }
      }
      for (let dependency of analysis.dependencies) {
        graph.add(dependency);
        // Trusted modules and already-recognized browser-only packages are
        // leaves: nothing their source could say would change the answer.
        if (
          !this.options.isTrustedModule(dependency) &&
          !isBundledBrowserOnlyPackage(dependency)
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
      return {
        ...failedClassification(failureReason()),
        moduleGraph,
        moduleGraphComplete: !walk.incomplete,
      };
    }

    // Positive evidence is reported ahead of any failure. Both reach Sandbox,
    // so precedence is chosen for what the diagnostic tells an author: "this
    // card imports three" is actionable, and "a module in its graph did not
    // load" — true of the same graph, of a package the loader was never going
    // to serve as source — is not. A failure decides the result only when
    // there is no positive evidence, which is exactly when an incomplete graph
    // could otherwise be mistaken for a clean one.
    if (root.tier === 'sandbox') {
      return { ...root, moduleGraph, moduleGraphComplete: !walk.incomplete };
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
        moduleGraphComplete: !walk.incomplete,
      };
    }
    if (exceededLimit || failures.length > 0) {
      return {
        ...failedClassification(failureReason()),
        moduleGraph,
        moduleGraphComplete: !walk.incomplete,
      };
    }
    return { ...root, moduleGraph, moduleGraphComplete: !walk.incomplete };
  }

  /**
   * Returns one module's analysis, from the shared memo when it holds a
   * current one.
   *
   * With no supplied source the memo is authoritative and nothing is fetched —
   * that is what lets a second entry traverse a shared subtree for free.
   * Supplied source bypasses the memo entirely, in both directions; see below.
   */
  private async analyzeModule(
    moduleIdentifier: string,
    suppliedSource?: string,
  ): Promise<ModuleAnalysis> {
    // Supplied source is one caller's revision of the module, not the module.
    // The shared memo answers every entry that reaches this identifier, so
    // seating a draft in it would let an unsaved editor buffer decide an
    // unrelated card's tier — including DOWNWARD, when the saved module needs a
    // browser and the draft does not, which RP-6.1 R5 forbids. So a draft is
    // analyzed for its own caller and neither read from nor written to the
    // shared memo; the entry memo, keyed by the draft's hash, is what keeps an
    // unchanged draft from re-analyzing.
    if (suppliedSource !== undefined) {
      return this.freshAnalysis(moduleIdentifier, suppliedSource);
    }
    let pending = this.moduleAnalyses.get(moduleIdentifier);
    if (pending) {
      // A rejection propagates to this caller rather than being retried
      // mid-walk: the module already self-evicted, so the retry is the next
      // classification, and this walk fails closed as it should.
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
      ({ analysis }) =>
        isTransientReason(analysis.reason) ? evict() : undefined,
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
    return { analysis, dependencies: [...dependencies].sort() };
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
    // Overridden by every walkGraph return, which knows what it reached.
    moduleGraphComplete: false,
  };
}

/**
 * The entry memo's key for a supplied draft, so an unchanged draft is answered
 * without re-walking its graph.
 *
 * FNV-1a over two lanes with different multipliers, folded to one hexadecimal
 * key. It is not a cryptographic digest and does not need to be: a collision
 * would let a changed draft reuse the previous revision's classification,
 * which costs the wrong CAGE — a Capsule where a Sandbox was wanted, or the
 * reverse. Neither is a trust failure. Whether code is Host-owned is decided
 * by `isTrustedModule` from the module's URL, which no cache participates in,
 * so no hash outcome can move authored code to Direct. Nor is there anything
 * to win by forcing a collision: an author who wants the Capsule can simply
 * write code with no browser signals in it.
 *
 * Synchronous so that the memo lookup it keys is too: the async digest APIs
 * would turn "has this draft already been classified" into a microtask that
 * every caller has to await before it can be answered from cache.
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
