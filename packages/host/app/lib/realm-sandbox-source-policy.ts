import * as babel from '@babel/core';
// @ts-ignore no upstream types are available
import typescriptPlugin from '@babel/plugin-transform-typescript';
import * as ContentTag from 'content-tag';
import { init, parse } from 'es-module-lexer';

export type CardRenderSandboxTier = 'compartment' | 'iframe';

export type CardSandboxRenderFormat =
  | 'isolated'
  | 'embedded'
  | 'fitted'
  | 'edit'
  | 'atom'
  | 'head'
  | 'markdown';

export interface CardSourceSandboxClassification {
  tier: CardRenderSandboxTier;
  reason: string;
  imports: string[];
  signals: string[];
  // Some iframe requirements are part of an exported render surface and must
  // follow a static import edge (for example Three.js or an unscoped template
  // style). Ambient browser globals are different: a library may contain a
  // dormant browser adapter that SES can safely leave unavailable. Promoting
  // every importer for a mere `document` token makes otherwise SES-compatible
  // cards depend on the hosted iframe service.
  propagatesToImporters: boolean;
}

const iframeRenderFormats = new Set<string>(['isolated', 'embedded', 'edit']);
const compiledLiteralStyleElement =
  /\[\s*10\s*,\s*(?:["']style["']|\\["']style\\["'])\s*\]/i;
const compiledDynamicInlineStyleAttribute =
  /\[\s*(?:15|16|22|23)\s*,\s*(?:5|\\*["']style\\*["'])\s*,/i;
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
// surfaces. Its fitted, atom, head, and markdown surfaces stay in SES and fail
// closed there if they depend on ambient DOM authority.
export function sandboxDecisionForFormat(
  decision: Pick<CardSourceSandboxClassification, 'tier' | 'reason'>,
  format: string | undefined,
): Pick<CardSourceSandboxClassification, 'tier' | 'reason'> {
  let effectiveFormat = format ?? 'isolated';
  if (decision.tier !== 'iframe' || iframeRenderFormats.has(effectiveFormat)) {
    return decision;
  }
  return {
    tier: 'compartment',
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

let lexerReady = Promise.resolve(init);

function analyzeEmbeddedTemplates(source: string): {
  javascript: string;
  hasDynamicInlineStyle: boolean;
  hasTopLayerAttribute: boolean;
  hasUnscopedStyle: boolean;
} {
  let characters = Array.from(source);
  let hasDynamicInlineStyle = false;
  let hasTopLayerAttribute = false;
  let hasUnscopedStyle = false;
  for (let match of new ContentTag.Preprocessor().parse(source)) {
    hasDynamicInlineStyle ||= /\sstyle\s*=\s*{{/i.test(match.contents);
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
    let executableSource = babel.transformSync(source, {
      filename: 'sandbox-card.ts',
      babelrc: false,
      configFile: false,
      compact: true,
      plugins: [[typescriptPlugin, { allowDeclareFields: true }]],
      parserOpts: { plugins: ['decorators-legacy'] },
    })?.code;
    return executableSource
      ? usedBrowserGlobals(executableSource)
      : possibleSignals;
  } catch {
    // Classification is a security boundary. Unknown or incomplete syntax
    // keeps the conservative result instead of silently gaining SES access.
    return possibleSignals;
  }
}

export async function classifyCardSourceForSandbox(
  source: string,
): Promise<CardSourceSandboxClassification> {
  let javascript: string;
  let dynamicInlineStyle = compiledDynamicInlineStyleAttribute.test(source);
  let topLayerAttribute = compiledTopLayerAttribute.test(source);
  let unscopedStyle = hasCompiledUnscopedStyle(source);
  try {
    let templateAnalysis = analyzeEmbeddedTemplates(source);
    dynamicInlineStyle ||= templateAnalysis.hasDynamicInlineStyle;
    topLayerAttribute ||= templateAnalysis.hasTopLayerAttribute;
    unscopedStyle ||= templateAnalysis.hasUnscopedStyle;
    javascript = templateAnalysis.javascript;
  } catch {
    // A malformed in-progress GTS draft remains in the more restrictive SES
    // renderer. The last-good-render path keeps the prior preview visible.
    return {
      tier: 'compartment',
      reason: 'source-parse-pending',
      imports: [],
      signals: [],
      propagatesToImporters: false,
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
      tier: 'compartment',
      reason: 'source-parse-pending',
      imports: [],
      signals: [],
      propagatesToImporters: false,
    };
  }

  let importSignals = imports
    .map(iframeImportSignal)
    .filter((signal): signal is string => Boolean(signal));
  let globalSignals = executableBrowserGlobals(javascript);
  let signals = [
    ...new Set([
      ...importSignals,
      ...globalSignals,
      ...(dynamicInlineStyle ? ['dynamic-inline-style'] : []),
      ...(topLayerAttribute ? ['top-layer-markup'] : []),
      ...(unscopedStyle ? ['unscoped-style'] : []),
    ]),
  ];
  let propagatesToImporters =
    importSignals.length > 0 ||
    dynamicInlineStyle ||
    topLayerAttribute ||
    unscopedStyle;
  if (signals.length > 0) {
    return {
      tier: 'iframe',
      reason: `browser-runtime:${signals.join(',')}`,
      imports,
      signals,
      propagatesToImporters,
    };
  }
  return {
    tier: 'compartment',
    reason: 'default-user-card',
    imports,
    signals: [],
    propagatesToImporters: false,
  };
}
