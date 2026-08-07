import * as babel from '@babel/core';
// @ts-ignore no upstream types are available
import typescriptPlugin from '@babel/plugin-transform-typescript';
import * as ContentTag from 'content-tag';
import { init, parse } from 'es-module-lexer';

import { networkBearingCSS } from './capsule-css-policy';

export type AuthoredExecutionMode = 'capsule' | 'sandbox';

export type BoxelRenderFormat =
  | 'isolated'
  | 'embedded'
  | 'fitted'
  | 'edit'
  | 'atom'
  | 'head'
  | 'markdown';

export interface BoxelSourceClassification {
  tier: AuthoredExecutionMode;
  reason: string;
  imports: string[];
  signals: string[];
  /** Resolved modules admitted to a stronger runtime's read capability. */
  moduleGraph: string[];
  // Some iframe requirements are part of an exported render surface and must
  // follow a static import edge (for example Three.js or an unscoped template
  // style). Ambient browser globals are different: a library may contain a
  // dormant browser adapter that SES can safely leave unavailable. Promoting
  // every importer for a mere `document` token makes otherwise Capsule-compatible
  // cards depend on the hosted iframe service.
  propagatesToImporters: boolean;
  /**
   * The module declares its own `static edit = …` template (an in-place
   * editor, often registered for both isolated and edit). RP-6.3: only such
   * a module keeps the Sandbox iframe for its edit surface — the SAME
   * retained iframe as its isolated render, preserving in-iframe state
   * across the format switch. A module without one gets the trusted Base
   * editor, which must run host-side against the canonical store.
   */
  authoredEditTemplate: boolean;
}

// RP-6.3: `edit` is deliberately NOT here. The edit surface is the trusted
// Base editor chrome operating on the canonical store — and the Sandbox has
// no child→parent write leg (RP-20.5 pushes parent→child only), so an
// iframe edit surface renders as a structurally read-only dead form (no
// CRUD context in the child, nothing to save through). Edit demotes to the
// Capsule like the compact formats: the standard editor runs host-side with
// real store access, and a browser-dependent authored field editor fails
// closed there instead of silently losing writes.
const iframeRenderFormats = new Set<string>(['isolated', 'embedded']);
const compiledLiteralStyleElement =
  /\[\s*10\s*,\s*(?:["']style["']|\\["']style\\["'])\s*\]/i;
const compiledDynamicInlineStyleAttribute =
  /\[\s*(?:15|16|22|23)\s*,\s*(?:5|\\*["']style\\*["'])\s*,/i;
const authoredDocumentGlobalStyle =
  /(?:@(?:font-face|font-feature-values|font-palette-values|property|counter-style|color-profile|page|viewport|(?:-moz-)?document|namespace|view-transition|position-try|scroll-timeline|custom-media|custom-selector)\b|@layer\b(?!\s*\{)|\bview-transition-(?:name|class)\s*:)/i;
// `networkBearingCSS` (imported above) covers `@import` and `url()`-family
// values. A Capsule stylesheet containing either is rejected at admission
// (capsule-css-policy.ts); routing here to Sandbox ahead of that rejection
// gives such a card a real document where the declaration is actually
// supported, exactly as `authoredDocumentGlobalStyle` already does for
// `@font-face`.
const topLayerAttributeName =
  '(?:command|commandfor|popover|popovertarget|popovertargetaction)';
const authoredTopLayerAttribute = new RegExp(
  `\\s${topLayerAttributeName}(?=\\s|=|/?>)`,
  'i',
);
const compiledTopLayerAttribute = new RegExp(
  `\\[\\s*(?:14|15|16|22|23|24)\\s*,\\s*\\\\?["']${topLayerAttributeName}\\\\?["']\\s*,`,
  'i',
);

// Source classification describes what the module needs. The requested card
// format separately limits where it may run. Compact and non-DOM formats must
// remain composable in the host document (especially the fitted gallery), so
// a browser-dependent definition receives an iframe only for its full/edit
// surfaces. Its fitted, atom, head, and markdown surfaces stay in a Capsule and fail
// closed there if they depend on ambient DOM authority.
export function executionDecisionForFormat(
  decision: Pick<BoxelSourceClassification, 'tier' | 'reason'> &
    Partial<Pick<BoxelSourceClassification, 'authoredEditTemplate'>>,
  format: string | undefined,
): Pick<BoxelSourceClassification, 'tier' | 'reason'> {
  let effectiveFormat = format ?? 'isolated';
  if (decision.tier !== 'sandbox' || iframeRenderFormats.has(effectiveFormat)) {
    return { tier: decision.tier, reason: decision.reason };
  }
  // An authored in-place editor keeps the SAME retained iframe as its
  // isolated render (the runtime router retains the process by surface
  // identity across format switches — no reload, in-iframe state survives).
  // Its child→parent edit propagation is the Sandbox write leg, tracked as
  // the next protocol milestone; until then it renders live but read-only.
  if (effectiveFormat === 'edit' && decision.authoredEditTemplate) {
    return { tier: decision.tier, reason: decision.reason };
  }
  return {
    tier: 'capsule',
    reason: `ses-only-format:${effectiveFormat}`,
  };
}

// These packages require a real browser document/canvas or are commonly
// loaded as browser-global renderers. They belong in the isolated iframe
// renderer, where authored CardDefs remain unaware of the transport.
const iframeImportSignals = [
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

const iframeGlobalSignals = [
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

// Browser authority is often hidden behind a value whose DOM type appears
// only in TypeScript syntax. `canvas.getContext()` is the canonical example:
// stripping the `HTMLCanvasElement` annotation must not make the executable
// member call look Capsule-compatible. Keep this list deliberately narrow. Each
// method below either acquires a browser rendering capability or depends on a
// live document-owned element in a way that our data-only SES shims cannot
// reproduce.
const iframeDOMMethodSignals = [
  'getContext',
  'requestPointerLock',
  'setPointerCapture',
  'showModal',
  'toBlob',
  'toDataURL',
] as const;

let lexerReady = Promise.resolve(init);

function analyzeEmbeddedTemplates(source: string): {
  javascript: string;
  hasDynamicInlineStyle: boolean;
  hasDocumentGlobalStyle: boolean;
  hasNetworkBearingStyle: boolean;
  hasGlobalStyleSelector: boolean;
  hasTopLayerAttribute: boolean;
  hasUnscopedStyle: boolean;
} {
  let characters = Array.from(source);
  let hasDynamicInlineStyle = false;
  let hasDocumentGlobalStyle = false;
  let hasNetworkBearingStyle = false;
  let hasGlobalStyleSelector = false;
  let hasTopLayerAttribute = false;
  let hasUnscopedStyle = false;
  for (let match of new ContentTag.Preprocessor().parse(source)) {
    // Boxel UI's cssVar helper is a trusted, declaration-only presentation
    // primitive. It does not require a browser-global runtime and is resolved
    // by reference in the Host when a Capsule template is reified. Keep every
    // other dynamic style expression on the stronger Sandbox path; the
    // Capsule evaluator independently verifies that the helper reference
    // actually came from the trusted Boxel UI module.
    for (let style of match.contents.matchAll(
      /\sstyle\s*=\s*{{\s*([^\s}]+)/gi,
    )) {
      hasDynamicInlineStyle ||= style[1] !== 'cssVar';
    }
    // A QUOTED style attribute with any interpolation
    // (`style='background: {{row.tone}}'`) compiles to a concat expression —
    // never the bare trusted cssVar invocation the Capsule admits — so it is
    // dynamic no matter what appears inside the mustache. Missing this form
    // classified such modules Capsule, where the evaluator then correctly
    // refused the template at admission (RP-6.1 R2 belongs here, ahead of
    // that rejection, so the card gets the iframe where inline styles are
    // actually supported).
    for (let style of match.contents.matchAll(
      /\sstyle\s*=\s*("[^"]*"|'[^']*')/gi,
    )) {
      hasDynamicInlineStyle ||= style[1].includes('{{');
    }
    for (let tag of match.contents.matchAll(/<[^>]+>/g)) {
      hasTopLayerAttribute ||= authoredTopLayerAttribute.test(tag[0]);
    }
    let styleTags = match.contents.matchAll(/<style(?=[\s>])([^>]*)>/gi);
    for (let styleTag of styleTags) {
      let attributes = styleTag[1] ?? '';
      if (!/(?:^|\s)scoped(?=\s|=|$)/i.test(attributes)) {
        hasUnscopedStyle = true;
      }
    }
    hasGlobalStyleSelector ||= /:global\s*\(/i.test(match.contents);
    hasDocumentGlobalStyle ||= authoredDocumentGlobalStyle.test(match.contents);
    hasNetworkBearingStyle ||= networkBearingCSS.test(match.contents);
    for (
      let index = match.range.startChar;
      index < match.range.endChar;
      index++
    ) {
      // Preserve newlines so parse errors and diagnostics retain source lines.
      if (characters[index] !== '\n' && characters[index] !== '\r') {
        characters[index] = ' ';
      }
    }
  }
  return {
    javascript: characters.join(''),
    hasDynamicInlineStyle,
    hasDocumentGlobalStyle,
    hasNetworkBearingStyle,
    hasGlobalStyleSelector,
    hasTopLayerAttribute,
    hasUnscopedStyle,
  };
}

function hasCompiledUnscopedStyle(source: string): boolean {
  // The realm server normally sends already-compiled card JavaScript to
  // interact mode. Ember's wire format represents a literal element as
  // [OpenElement, tagName], where OpenElement is opcode 10. A scoped style is
  // extracted by glimmer-scoped-css and never produces this tuple. This signal
  // is only a compatibility router; template capture independently rejects the
  // literal style and remains the fail-closed security boundary.
  return compiledLiteralStyleElement.test(source);
}

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

function packageName(moduleIdentifier: string): string {
  try {
    let url = new URL(moduleIdentifier);
    if (url.hostname === 'esm.sh') {
      let pathname = url.pathname.replace(/^\//, '').toLowerCase();
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

function iframeImportSignal(moduleIdentifier: string): string | undefined {
  let candidate = packageName(moduleIdentifier);
  return iframeImportSignals.find(
    (signal) =>
      candidate === signal ||
      candidate.startsWith(`${signal}/`) ||
      candidate.includes(`/${signal}/`) ||
      candidate.includes(`/${signal}@`),
  );
}

function usedBrowserGlobals(source: string): string[] {
  let code = maskStringsAndComments(source);
  return iframeGlobalSignals.filter((signal) =>
    new RegExp(`\\b${signal}\\b`).test(code),
  );
}

function executableBrowserGlobals(source: string): string[] {
  let possibleSignals = usedBrowserGlobals(source);
  if (possibleSignals.length === 0) {
    return [];
  }

  try {
    // Card source is TypeScript. A DOM name in an interface, type annotation,
    // or `as HTMLElement` assertion does not request browser authority. Strip
    // type-only syntax before deciding whether the module needs an iframe.
    // We only pay for this parse when a possible browser global was found.
    let unboundBrowserGlobals = new Set<string>();
    let collectUnboundBrowserGlobals: babel.PluginObj = {
      visitor: {
        ReferencedIdentifier(path) {
          let name = path.node.name;
          if (
            !iframeGlobalSignals.includes(
              name as (typeof iframeGlobalSignals)[number],
            ) ||
            path.scope.hasBinding(name)
          ) {
            return;
          }
          // `typeof window` acquires no authority: on an unresolvable name
          // it evaluates to 'undefined' WITHOUT throwing, so the standard
          // isomorphic guard (`typeof window !== 'undefined' && …`) runs
          // correctly inside the Capsule compartment. Any other reference
          // to the same name — including the guarded branch's actual use —
          // still classifies to the Sandbox tier.
          if (
            babel.types.isUnaryExpression(path.parent, {
              operator: 'typeof',
            }) &&
            path.parent.argument === path.node
          ) {
            return;
          }
          unboundBrowserGlobals.add(name);
        },
      },
    };
    babel.transformSync(source, {
      filename: 'boxel-source.ts',
      babelrc: false,
      configFile: false,
      compact: true,
      plugins: [
        [typescriptPlugin, { allowDeclareFields: true }],
        collectUnboundBrowserGlobals,
      ],
      parserOpts: { plugins: ['decorators-legacy'] },
    });
    return iframeGlobalSignals.filter((signal) =>
      unboundBrowserGlobals.has(signal),
    );
  } catch {
    // Classification is a security boundary. Unknown or incomplete syntax
    // keeps the conservative result instead of silently gaining SES access.
    return possibleSignals;
  }
}

function executableDOMMethodCalls(source: string): string[] {
  let possibleSignals = iframeDOMMethodSignals.filter((method) =>
    new RegExp(`\\.${method}\\s*\\(`).test(source),
  );
  if (possibleSignals.length === 0) {
    return [];
  }

  try {
    let calls = new Set<string>();
    let collectCalls: babel.PluginObj = {
      visitor: {
        CallExpression(path) {
          let callee = path.node.callee;
          if (
            babel.types.isMemberExpression(callee) &&
            !callee.computed &&
            babel.types.isIdentifier(callee.property) &&
            iframeDOMMethodSignals.includes(
              callee.property.name as (typeof iframeDOMMethodSignals)[number],
            )
          ) {
            calls.add(callee.property.name);
          }
        },
      },
    };
    babel.transformSync(source, {
      filename: 'boxel-source.ts',
      babelrc: false,
      configFile: false,
      compact: true,
      plugins: [[typescriptPlugin, { allowDeclareFields: true }], collectCalls],
      parserOpts: { plugins: ['decorators-legacy'] },
    });
    return iframeDOMMethodSignals
      .filter((method) => calls.has(method))
      .map((method) => `dom-method:${method}`);
  } catch {
    // As with unbound globals, ambiguous executable syntax fails toward the
    // stronger process boundary instead of silently receiving SES access.
    return possibleSignals.map((method) => `dom-method:${method}`);
  }
}

export async function classifyBoxelSource(
  source: string,
): Promise<BoxelSourceClassification> {
  let javascript: string;
  let dynamicInlineStyle = compiledDynamicInlineStyleAttribute.test(source);
  let documentGlobalStyle = false;
  let networkBearingStyle = false;
  let globalStyleSelector = false;
  let topLayerAttribute = compiledTopLayerAttribute.test(source);
  let unscopedStyle = hasCompiledUnscopedStyle(source);
  try {
    let templateAnalysis = analyzeEmbeddedTemplates(source);
    dynamicInlineStyle ||= templateAnalysis.hasDynamicInlineStyle;
    documentGlobalStyle ||= templateAnalysis.hasDocumentGlobalStyle;
    networkBearingStyle ||= templateAnalysis.hasNetworkBearingStyle;
    globalStyleSelector ||= templateAnalysis.hasGlobalStyleSelector;
    topLayerAttribute ||= templateAnalysis.hasTopLayerAttribute;
    unscopedStyle ||= templateAnalysis.hasUnscopedStyle;
    javascript = templateAnalysis.javascript;
  } catch {
    // A malformed in-progress GTS draft remains in the more restrictive SES
    // renderer. The last-good-render path keeps the prior preview visible.
    return {
      tier: 'capsule',
      reason: 'source-parse-pending',
      imports: [],
      signals: [],
      moduleGraph: [],
      propagatesToImporters: false,
      authoredEditTemplate: false,
    };
  }

  await lexerReady;
  let imports: string[];
  try {
    imports = parse(javascript)[0]
      .map((entry) => entry.n)
      .filter(
        (specifier): specifier is string => typeof specifier === 'string',
      );
  } catch {
    return {
      tier: 'capsule',
      reason: 'source-parse-pending',
      imports: [],
      signals: [],
      moduleGraph: [],
      propagatesToImporters: false,
      authoredEditTemplate: false,
    };
  }

  // `static edit = …` on a card class declares an authored in-place editor
  // (RP-6.3): only the template CONTENT was blanked above, so the class-body
  // assignment itself is still visible here.
  let authoredEditTemplate = /\bstatic\s+edit\s*=/.test(javascript);
  let importSignals = imports
    .map(iframeImportSignal)
    .filter((signal): signal is string => Boolean(signal));
  let globalSignals = executableBrowserGlobals(javascript);
  let domMethodSignals = executableDOMMethodCalls(javascript);
  let signals = [
    ...new Set([
      ...importSignals,
      ...globalSignals,
      ...domMethodSignals,
      ...(dynamicInlineStyle ? ['dynamic-inline-style'] : []),
      ...(documentGlobalStyle ? ['document-global-style'] : []),
      ...(networkBearingStyle ? ['network-bearing-style'] : []),
      ...(globalStyleSelector ? ['global-style-selector'] : []),
      ...(topLayerAttribute ? ['top-layer-markup'] : []),
      ...(unscopedStyle ? ['unscoped-style'] : []),
    ]),
  ];
  let propagatesToImporters =
    importSignals.length > 0 ||
    domMethodSignals.length > 0 ||
    dynamicInlineStyle ||
    documentGlobalStyle ||
    networkBearingStyle ||
    globalStyleSelector ||
    topLayerAttribute ||
    unscopedStyle;
  if (signals.length > 0) {
    return {
      tier: 'sandbox',
      reason: `browser-runtime:${signals.join(',')}`,
      imports,
      signals,
      moduleGraph: [],
      propagatesToImporters,
      authoredEditTemplate,
    };
  }
  return {
    tier: 'capsule',
    reason: 'default-user-card',
    imports,
    signals: [],
    moduleGraph: [],
    propagatesToImporters: false,
    authoredEditTemplate,
  };
}

export interface BoxelModuleGraphClassifierOptions {
  loadSource(moduleIdentifier: string): Promise<string>;
  resolveImport(specifier: string, relativeTo: string): string;
  isTrustedModule(moduleIdentifier: string): boolean;
  maxModules?: number;
}

/**
 * Classifies one executable authored module graph, not merely its entry file.
 *
 * Trusted modules are explicit leaves. An authored dependency whose browser
 * requirement propagates to importers strengthens the entry module to the
 * Sandbox tier. The walk is bounded and fails closed when a dependency cannot
 * be resolved, loaded, or when the graph exceeds its configured size.
 */
export class BoxelModuleGraphClassifier {
  private cache = new Map<string, Promise<BoxelSourceClassification>>();
  private entrySources = new Map<string, string>();
  private dependencies = new Map<string, Set<string>>();

  constructor(private readonly options: BoxelModuleGraphClassifierOptions) {}

  classify(
    moduleIdentifier: string,
    source?: string,
  ): Promise<BoxelSourceClassification> {
    let existing = this.cache.get(moduleIdentifier);
    if (
      existing &&
      (source === undefined ||
        this.entrySources.get(moduleIdentifier) === source)
    ) {
      return existing;
    }
    if (existing) {
      this.invalidate(moduleIdentifier);
    }
    let observedDependencies = new Set<string>();
    let classification = this.classifyGraph(
      moduleIdentifier,
      source,
      observedDependencies,
    );
    this.cache.set(moduleIdentifier, classification);
    if (source !== undefined) {
      this.entrySources.set(moduleIdentifier, source);
    }
    this.dependencies.set(moduleIdentifier, observedDependencies);
    void classification.catch(() => {
      if (this.cache.get(moduleIdentifier) === classification) {
        this.cache.delete(moduleIdentifier);
        this.entrySources.delete(moduleIdentifier);
        this.dependencies.delete(moduleIdentifier);
      }
    });
    return classification;
  }

  invalidate(moduleIdentifier?: string): void {
    if (moduleIdentifier) {
      for (let [entry, dependencies] of this.dependencies) {
        if (entry === moduleIdentifier || dependencies.has(moduleIdentifier)) {
          this.cache.delete(entry);
          this.entrySources.delete(entry);
          this.dependencies.delete(entry);
        }
      }
    } else {
      this.cache.clear();
      this.entrySources.clear();
      this.dependencies.clear();
    }
  }

  private async classifyGraph(
    moduleIdentifier: string,
    entrySource?: string,
    observedDependencies = new Set<string>(),
  ): Promise<BoxelSourceClassification> {
    let visited = new Set<string>();
    let maxModules = this.options.maxModules ?? 256;

    let visit = async (
      identifier: string,
      suppliedSource?: string,
    ): Promise<BoxelSourceClassification> => {
      if (this.options.isTrustedModule(identifier) || visited.has(identifier)) {
        return capsuleClassification();
      }
      visited.add(identifier);
      if (visited.size > maxModules) {
        return unavailableClassification('module-graph-limit');
      }

      let source: string;
      try {
        source = suppliedSource ?? (await this.options.loadSource(identifier));
      } catch {
        return unavailableClassification(`module-load:${identifier}`);
      }
      let own = await classifyBoxelSource(source);
      let dependencies: string[] = [];
      for (let specifier of own.imports) {
        // Trusted package imports are already canonical execution leaves. Do
        // not ask VirtualNetwork to resolve them: resolving an async package
        // shim can evaluate the trusted Base module merely to discover its
        // URL, which turns classification into an eager module load (and can
        // pull in unrelated transitive network dependencies). The runtime
        // resolves the reference only if the authored template actually uses
        // that trusted export.
        if (this.options.isTrustedModule(specifier)) {
          observedDependencies.add(specifier);
          dependencies.push(specifier);
          continue;
        }
        let dependency: string;
        try {
          dependency = this.options.resolveImport(specifier, identifier);
        } catch {
          return unavailableClassification(`module-resolve:${specifier}`);
        }
        observedDependencies.add(dependency);
        dependencies.push(dependency);
      }
      if (own.tier === 'sandbox') {
        // The stronger boundary is already decided, but the Sandbox loader
        // still needs the complete, statically observed module graph. Walk
        // authored dependencies for authority discovery without allowing a
        // dependency to weaken or otherwise replace the root decision.
        for (let dependency of dependencies) {
          if (!this.options.isTrustedModule(dependency)) {
            await visit(dependency);
          }
        }
        return own;
      }

      for (let dependency of dependencies) {
        if (this.options.isTrustedModule(dependency)) {
          continue;
        }
        let dependencyClassification = await visit(dependency);
        if (
          dependencyClassification.tier === 'sandbox' &&
          dependencyClassification.propagatesToImporters
        ) {
          return {
            tier: 'sandbox',
            reason: `dependency-runtime:${dependency}`,
            imports: own.imports,
            signals: dependencyClassification.signals,
            moduleGraph: [],
            propagatesToImporters: true,
            authoredEditTemplate: own.authoredEditTemplate,
          };
        }
      }
      return own;
    };

    let result = await visit(moduleIdentifier, entrySource);
    return {
      ...result,
      moduleGraph: [moduleIdentifier, ...observedDependencies],
    };
  }
}

function capsuleClassification(): BoxelSourceClassification {
  return {
    tier: 'capsule',
    reason: 'trusted-or-visited-module',
    imports: [],
    signals: [],
    moduleGraph: [],
    propagatesToImporters: false,
    authoredEditTemplate: false,
  };
}

function unavailableClassification(reason: string): BoxelSourceClassification {
  return {
    tier: 'sandbox',
    reason,
    imports: [],
    signals: [reason],
    moduleGraph: [],
    propagatesToImporters: true,
    authoredEditTemplate: false,
  };
}
