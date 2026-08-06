import { join, scheduleOnce } from '@ember/runloop';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { modifier } from 'ember-modifier';
import { provide } from 'ember-provide-consume-context';
import { initSync, parse } from 'es-module-lexer';

import {
  DefaultFormatsContextName,
  Loader,
  fetcher,
  maybeHandleScopedCSSRequest,
  type BoxelInstanceHandle,
  type ModuleEvaluator,
  type ModuleRegistration,
} from '@cardstack/runtime-common';

import { installBoxelLoaderCompatibilityModules } from '@cardstack/host/lib/boxel-loader-compatibility';
import DirectBoxelRuntime from '@cardstack/host/lib/direct-boxel-runtime';
import type { SandboxRenderTarget } from '@cardstack/host/lib/sandbox-render-transport';
import {
  installSandboxRuntimeHost,
  type SandboxRenderDiagnostic,
} from '@cardstack/host/lib/sandbox-runtime-host';
import { connectSandboxSurface } from '@cardstack/host/lib/sandbox-surface-transport';
import type { SandboxSurfaceClient } from '@cardstack/host/lib/sandbox-surface-transport';
import type { BoxelSandboxRuntimeModel } from '@cardstack/host/routes/boxel-sandbox-runtime';
import type NetworkService from '@cardstack/host/services/network';

import type { Format } from '@cardstack/base/card-api';
import type { ComponentLike } from '@glint/template';

interface Signature {
  Args: { model: BoxelSandboxRuntimeModel };
}

interface SandboxComponentSignature {
  Args: { format: string };
  Element: Element;
}

/**
 * RP-16.1's `layout` capability crosses to `SurfaceService.layout()`, whose
 * `minimumHeight` is the one field that actually reaches an element's CSS —
 * `SurfaceService.applyLayout` sets it as the *parent-side* attached
 * element's own `min-height`, and `boxel-execution-renderer.gts`'s Sandbox
 * iframe CSS (`min-height: inherit`) picks that up from its wrapper. But
 * nothing drives it for the Sandbox tier without this: the parent cannot
 * ResizeObserve content inside a cross-origin iframe the way
 * `SurfaceElementModifier` does for Direct/Capsule (via `SurfaceService
 * .attach`, which installs the ResizeObserver on the real, same-document
 * render root) — intrinsic height has to originate here, in the child,
 * where the content actually lives, and be pushed across explicitly.
 */
export function reportIntrinsicHeight(
  element: HTMLElement,
  surface: SandboxSurfaceClient,
): () => void {
  let lastReportedHeight: number | undefined;
  let reportHeight = () => {
    let height = Math.ceil(element.getBoundingClientRect().height);
    if (height === lastReportedHeight) {
      return;
    }
    lastReportedHeight = height;
    console.warn('[sandbox-child] height reported', { height });
    void surface
      .layout({ heightMode: 'intrinsic', minimumHeight: height })
      .catch((error) => {
        console.error('Sandbox Surface height report failed', error);
      });
  };
  let resizeObserver: ResizeObserver | undefined;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(reportHeight);
    resizeObserver.observe(element);
  }
  // The render root exists (this modifier only attaches once `this.surface`
  // is set) but is very likely still empty at install time — bootstrap
  // reaches 'ready' well before the first render request. Reporting now
  // establishes a baseline; the observer above reports again (and only
  // then, since it's deduped) once the card actually renders and the
  // element's real size lands.
  reportHeight();
  return () => resizeObserver?.disconnect();
}

const attachSurface = modifier<{
  Args: { Positional: [SandboxSurfaceClient] };
  Element: HTMLElement;
}>((element, [surface]) => {
  let disconnectEvents = connectSandboxSurface(element, surface, (error) => {
    console.error('Sandbox Surface capability failed', error);
  });
  let stopHeightReporting = reportIntrinsicHeight(element, surface);
  return () => {
    stopHeightReporting();
    disconnectEvents();
  };
});

let esModuleLexerInitialized = false;

function ensureESModuleLexerInitialized(): boolean {
  if (esModuleLexerInitialized) {
    return true;
  }
  try {
    initSync();
    esModuleLexerInitialized = true;
  } catch (error) {
    // Best-effort: leave dynamic import() calls exactly as authored rather
    // than fail the whole module. They will still evaluate (as a native,
    // unmediated dynamic import) — the pre-existing behavior — just without
    // the RP-15.3 authority routing below.
    console.error('Sandbox dynamic-import rewrite unavailable', error);
  }
  return esModuleLexerInitialized;
}

/**
 * RP-15.3: `transpileAmd` only rewrites *static* `import`/`export`
 * declarations into AMD dependencies — a dynamic `import(...)` expression
 * embedded in authored source (the common way a card lazily loads a heavy
 * third-party library like Three.js from esm.sh) survives verbatim into the
 * eval'd factory body. Evaluated by a direct `eval()`, that literal
 * `import()` is a real native dynamic import whose specifier resolves
 * against the *currently executing script* — the Host's own bundle chunk
 * that contains the evaluator, not the module being evaluated — and its
 * fetch never reaches `SandboxFetchClient`, bypassing the Host-brokered,
 * classified-graph-checked module read this tier requires.
 *
 * Rewrites every dynamic `import(...)` call site (found via `es-module-lexer`,
 * so only real dynamic-import expressions are touched — string and comment
 * contents are untouched) to a call to `__boxelDynamicImport__`, a name
 * bound in the eval scope below that resolves the specifier against the
 * *authored module's own identifier* and routes it through the same Loader
 * (and therefore the same SandboxFetchClient/module-authority check) as
 * every static import.
 */
export function rewriteDynamicImports(source: string): string {
  if (!ensureESModuleLexerInitialized()) {
    return source;
  }
  let imports: readonly { d: number }[];
  try {
    imports = parse(source)[0];
  } catch {
    // Unparseable-by-the-lexer source still reaches the AMD evaluator below
    // unchanged; a real syntax error surfaces there with its usual message.
    return source;
  }
  let dynamicImportParenStarts = imports
    .filter((entry) => entry.d > -1)
    .map((entry) => entry.d)
    .sort((a, b) => b - a); // splice back-to-front so earlier offsets hold
  if (dynamicImportParenStarts.length === 0) {
    return source;
  }
  let rewritten = source;
  for (let parenStart of dynamicImportParenStarts) {
    // `d` is the offset of the call's opening `(`, not the `import` keyword
    // itself (verified empirically — es-module-lexer's own .d.ts comment is
    // ambiguous on this point).
    let keywordStart = parenStart - 'import'.length;
    rewritten =
      rewritten.slice(0, keywordStart) +
      '__boxelDynamicImport__' +
      rewritten.slice(parenStart);
  }
  return rewritten;
}

export function createSandboxModuleEvaluator(
  getLoader: () => Loader,
): ModuleEvaluator {
  return function sandboxModuleEvaluator(
    source: string,
    moduleIdentifier: string,
  ): ModuleRegistration {
    let rewrittenSource = rewriteDynamicImports(source);
    type DefineFunc = ((
      mid: string,
      dependencyList: string[],
      impl: Function,
    ) => void) & {
      registration?: ModuleRegistration;
    };
    // Mirrors runtime-common's own `evaluateModuleInCurrentRealm`: `define`
    // is a local visible to the eval'd source via direct eval's shared
    // lexical scope, not a global. `__boxelDynamicImport__` joins it for the
    // same reason — see `rewriteDynamicImports` above for why it exists.
    let define = ((_mid: string, dependencyList: string[], impl: Function) => {
      define.registration = { dependencyList, implementation: impl };
    }) as DefineFunc;
    let __boxelDynamicImport__ = (specifier: unknown): Promise<unknown> => {
      if (typeof specifier !== 'string') {
        return Promise.reject(
          new Error(
            'Sandbox dynamic import() requires a literal string module specifier',
          ),
        );
      }
      let resolved: string;
      try {
        resolved = new URL(specifier, moduleIdentifier).href;
      } catch (error) {
        return Promise.reject(error);
      }
      // A dynamic import() can live inside ANY evaluated module, not only an
      // authored card's own source — including trusted Base-realm modules
      // this rewrite applies to just the same (the evaluator has no
      // per-module opt-out; see rewriteDynamicImports). If one of those
      // targets a module the classified graph never seeded (base-realm code
      // dynamically loading an optional dependency the classifier doesn't
      // walk into), this call is exactly where that would surface — as a
      // rejection ("outside its classified graph"), not a hang, but log
      // begun/completed regardless so a genuinely slow or stuck fetch is
      // distinguishable from one that never started.
      console.warn('[sandbox-child] dynamic import begun', {
        specifier,
        resolved,
        fromModule: moduleIdentifier,
      });
      return getLoader()
        .import(resolved)
        .then(
          (result) => {
            console.warn('[sandbox-child] dynamic import completed', {
              resolved,
            });
            return result;
          },
          (error) => {
            console.warn('[sandbox-child] dynamic import failed', {
              resolved,
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          },
        );
    };
    // `__boxelDynamicImport__` is read only by the eval'd source below, not
    // by any statically-visible call site — this reference exists purely to
    // keep the binding (and a build tool that might otherwise elide it) from
    // being considered unused. See the comment above `rewriteDynamicImports`.
    void __boxelDynamicImport__;
    eval(rewrittenSource);
    if (!define.registration) {
      throw new Error(`Module ${moduleIdentifier} did not register itself`);
    }
    return define.registration;
  };
}

/**
 * Trusted shell inside the isolated origin. Authored Glimmer and its DOM stay
 * below this component; only opaque handles and capability messages cross to
 * the parent Host.
 */
export default class BoxelSandboxRuntime extends Component<Signature> {
  @service declare private network: NetworkService;

  @tracked private renderedComponent?: ComponentLike<SandboxComponentSignature>;
  @tracked private format: Format = 'isolated';
  @tracked private surface?: SandboxSurfaceClient;
  @tracked private error?: Error;

  private abortBootstrap = new AbortController();
  private loader?: Loader;
  private runtime?: DirectBoxelRuntime;
  private moduleFetchHandler?: (request: Request) => Promise<Response>;
  private reportRenderDiagnostic?: (
    diagnostic: SandboxRenderDiagnostic,
  ) => void;

  @provide(DefaultFormatsContextName)
  // @ts-ignore "defaultFormat is declared but not used"
  private get defaultFormat() {
    return { cardDef: this.format, fieldDef: this.format };
  }

  private runtimeHost = installSandboxRuntimeHost({
    parentOrigin: this.args.model.parentOrigin,
    bootstrapId: this.args.model.bootstrapId,
    createRuntime: (moduleFetch) => {
      this.moduleFetchHandler = (request) => moduleFetch(request);
      this.network.mount(this.moduleFetchHandler);
      let fetch = fetcher(
        this.network.fetch,
        [
          async (request, next) =>
            (await maybeHandleScopedCSSRequest(request)) || next(request),
        ],
        this.network.virtualNetwork,
      );
      this.loader = new Loader(fetch, this.network.resolveImport, {
        virtualNetwork: this.network.virtualNetwork,
        moduleEvaluator: createSandboxModuleEvaluator(() => this.loader!),
      });
      installBoxelLoaderCompatibilityModules(this.loader);
      this.runtime = new DirectBoxelRuntime(
        () => this.loader!.import('@cardstack/base/card-api'),
        () => this.loader!,
      );
      return this.runtime;
    },
    createRenderTarget: (_runtime, surface, reportRenderDiagnostic) => {
      join(() => (this.surface = surface));
      this.reportRenderDiagnostic = reportRenderDiagnostic;
      return this.renderTarget;
    },
    signal: this.abortBootstrap.signal,
  }).catch((error) => {
    if (!this.abortBootstrap.signal.aborted) {
      join(() => (this.error = asError(error)));
    }
    return undefined;
  });

  private renderTarget: SandboxRenderTarget = {
    render: async (card: BoxelInstanceHandle, format: string) => {
      // Breadcrumb 6/7: the render-transport dispatcher (sandbox-render-
      // transport.ts, parent-owned) called this the moment it received the
      // render request off the wire — this is the earliest point in the
      // sandboxed render path this component itself can observe, so it
      // stands in for "render request received".
      console.warn('[sandbox-child] render begun', { card, format });
      if (!this.runtime) {
        throw new Error('Sandbox runtime is unavailable');
      }
      let slot = this.runtime.getRenderSlotForHandle(card);
      join(() => {
        this.format = format as Format;
        this.renderedComponent =
          slot.component as ComponentLike<SandboxComponentSignature>;
        this.error = undefined;
      });
      await afterRender();
      // Breadcrumb 7/7: the Glimmer flush this awaited has committed —
      // report what actually landed in the DOM. The render-response ack
      // (sandbox-render-transport.ts) only proves this promise resolved,
      // not that anything visible came out of it.
      let diagnostic = measureRenderedOutput(
        document.querySelector('[data-boxel-sandbox-runtime]'),
        format,
      );
      console.warn('[sandbox-child] render completed', diagnostic);
      this.reportRenderDiagnostic?.(diagnostic);
    },
    clear: async () => {
      join(() => {
        this.renderedComponent = undefined;
        this.error = undefined;
      });
      await afterRender();
    },
  };

  willDestroy(): void {
    super.willDestroy();
    this.abortBootstrap.abort();
    void this.runtimeHost.then((host) => host?.destroy());
    this.loader?.dispose();
    if (this.moduleFetchHandler) {
      this.network.virtualNetwork.unmount(this.moduleFetchHandler);
      this.moduleFetchHandler = undefined;
    }
    this.loader = undefined;
    this.runtime = undefined;
  }

  <template>
    {{#if this.error}}
      <p class='boxel-sandbox-runtime__error' role='alert'>
        {{this.error.message}}
      </p>
    {{else if this.surface}}
      <main
        class='boxel-sandbox-runtime'
        data-boxel-sandbox-runtime
        {{attachSurface this.surface}}
      >
        {{#if this.renderedComponent}}
          <this.renderedComponent @format={{this.format}} />
        {{/if}}
      </main>
    {{/if}}
    <style scoped>
      :global(html),
      :global(body) {
        margin: 0;
        min-height: 100%;
        background: transparent;
      }

      .boxel-sandbox-runtime {
        min-height: 100%;
      }

      .boxel-sandbox-runtime__error {
        margin: 1rem;
        color: #b42318;
        font:
          0.875rem/1.4 system-ui,
          sans-serif;
      }
    </style>
  </template>
}

function afterRender(): Promise<void> {
  return new Promise((resolve) => scheduleOnce('afterRender', null, resolve));
}

/**
 * Bounded measurement of the committed DOM under the Sandbox's own render
 * root, taken right after `afterRender()` — so a render that acked
 * successfully but produced no visible output (getComponent+render ran, but
 * the card's own template branched to nothing, or an app-level dependency
 * it silently relies on was absent) is observable from the diagnostic
 * rather than requiring a screenshot.
 */
export function measureRenderedOutput(
  root: Element | null,
  format: string,
): SandboxRenderDiagnostic {
  let bodyChildren = Array.from(document.body.children).map((el) => ({
    tag: el.tagName.toLowerCase(),
    id: el.id,
    className: typeof el.className === 'string' ? el.className : '',
  }));
  let documentVisibilityState = document.visibilityState;
  let bodyChildElementCount = document.body.childElementCount;
  if (!root) {
    return {
      format,
      elementCount: 0,
      textLength: 0,
      hasVisibleContent: false,
      bodyChildElementCount,
      bodyChildren,
      rootRect: { width: 0, height: 0, top: 0, left: 0 },
      rootHasOffsetParent: false,
      documentVisibilityState,
    };
  }
  let elementCount = root.querySelectorAll('*').length;
  let textLength = (root.textContent ?? '').trim().length;
  let rect = root.getBoundingClientRect();
  let rootHasOffsetParent =
    root instanceof HTMLElement ? root.offsetParent !== null : false;
  // A rendered element with zero on-screen size is not "visible" even if it
  // has content and descendant elements — that's exactly the "acked but
  // painted nothing" case. A prior version of this check treated a nonzero
  // textLength as sufficient on its own (an OR, not an AND, against the
  // size check), which made a zero-size/unpainted render read as visible —
  // precisely the false positive that hid this defect from the diagnostic.
  let hasVisibleContent =
    elementCount > 0 && textLength > 0 && (rect.width > 0 || rect.height > 0);
  return {
    format,
    elementCount,
    textLength,
    hasVisibleContent,
    bodyChildElementCount,
    bodyChildren,
    rootRect: {
      width: rect.width,
      height: rect.height,
      top: rect.top,
      left: rect.left,
    },
    rootHasOffsetParent,
    documentVisibilityState,
  };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
