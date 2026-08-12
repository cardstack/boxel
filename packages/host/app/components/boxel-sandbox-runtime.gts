import { join, scheduleOnce } from '@ember/runloop';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { modifier } from 'ember-modifier';
import { consume, provide } from 'ember-provide-consume-context';
import ContextProvider from 'ember-provide-consume-context/components/context-provider';
import { initSync, parse } from 'es-module-lexer';

import {
  CardContextName,
  DefaultFormatsContextName,
  Loader,
  PermissionsContextName,
  fetcher,
  maybeHandleScopedCSSRequest,
  surfaceHeightModeFor,
  type BoxelInstanceHandle,
  type LooseSingleCardDocument,
  type ModuleEvaluator,
  type ModuleRegistration,
  type Permissions,
  type SurfaceHeightMode,
} from '@cardstack/runtime-common';

import { installBoxelLoaderCompatibilityModules } from '@cardstack/host/lib/boxel-loader-compatibility';
import DirectBoxelRuntime from '@cardstack/host/lib/direct-boxel-runtime';
import CardStoreWithGarbageCollection from '@cardstack/host/lib/gc-card-store';
import SandboxMediaBridge from '@cardstack/host/lib/sandbox-media-bridge';
import type { SandboxRenderTarget } from '@cardstack/host/lib/sandbox-render-transport';
import {
  installSandboxRuntimeHost,
  type SandboxRenderDiagnosticReporter,
  type SandboxRenderDiagnostic,
} from '@cardstack/host/lib/sandbox-runtime-host';
import { connectSandboxSurface } from '@cardstack/host/lib/sandbox-surface-transport';
import type { SandboxSurfaceClient } from '@cardstack/host/lib/sandbox-surface-transport';
import {
  createSandboxToolContext,
  installSandboxToolCompatibilityModules,
} from '@cardstack/host/lib/sandbox-tool-compatibility';
import type { SandboxViewCardClient } from '@cardstack/host/lib/sandbox-view-card-transport';
import type { SandboxWriteClient } from '@cardstack/host/lib/sandbox-write-transport';
import type { BoxelSandboxRuntimeModel } from '@cardstack/host/routes/boxel-sandbox-runtime';
import type NetworkService from '@cardstack/host/services/network';

import type {
  CardContext,
  CardDef,
  FieldType,
  Format,
} from '@cardstack/base/card-api';
import type { ComponentLike } from '@glint/template';
import type Modifier from 'ember-modifier';

interface Signature {
  Args: { model: BoxelSandboxRuntimeModel };
}

interface SandboxComponentSignature {
  Args: { format: string; context: CardContext };
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
  let stopped = false;
  let lastReportedHeight: number | undefined;
  let reportHeight = () => {
    if (stopped) {
      // fonts.ready (and a MutationObserver takeRecords tail) can deliver
      // after teardown; a report from a torn-down reporter must not land.
      return;
    }
    // Scroll height, not the bounding rect: the rect is the LAID-OUT box,
    // which is bounded by the iframe's own current viewport — measuring it
    // feeds the viewport back to the parent that sets the viewport, a loop
    // that ratchets in steps and never converges on the content's height.
    // Scroll height is the content's demand regardless of the box it's
    // currently squeezed into (overflow included), so the very first
    // report is already final (until the content itself changes).
    let height = Math.ceil(element.scrollHeight);
    if (height === lastReportedHeight) {
      return;
    }
    lastReportedHeight = height;
    console.debug('[sandbox-child] height reported', { height });
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
  // Scroll height changes without a box-size change (content growing inside
  // an overflow container, text swaps) are invisible to ResizeObserver —
  // only a mutation observer sees them. Late-loading webfonts reflow text
  // without mutating anything, so fonts.ready re-measures too. Both
  // callbacks are already batch-delivered by the platform, and the
  // value-dedupe above keeps repeat measurements off the wire.
  let mutationObserver: MutationObserver | undefined;
  if (typeof MutationObserver !== 'undefined') {
    mutationObserver = new MutationObserver(reportHeight);
    mutationObserver.observe(element, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
  }
  globalThis.addEventListener('resize', reportHeight);
  document.fonts?.ready.then(reportHeight).catch(() => undefined);
  // The render root exists (this modifier only attaches once `this.surface`
  // is set) but is very likely still empty at install time — bootstrap
  // reaches 'ready' well before the first render request. Reporting now
  // establishes a baseline; the observers above report again (deduped)
  // once the card actually renders and its real content height lands.
  reportHeight();
  return () => {
    stopped = true;
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    globalThis.removeEventListener('resize', reportHeight);
  };
}

/**
 * RP-15.3: re-measures and re-posts the render diagnostic whenever the
 * render root's own box changes — sharing the exact box-change signal
 * `reportIntrinsicHeight` already tracks for height, on the same element.
 *
 * `measureRenderedOutput`'s normal call site (the render-transport `render()`
 * below) is a one-shot measurement taken right after a single render
 * request resolves. If the iframe's own viewport is zero-width at that
 * exact moment — most commonly because its ancestor slot element in the
 * parent document hasn't finished an opening transition yet, seen on a page
 * reload — that measurement (correctly) reports `hasVisibleContent: false`,
 * and nothing else ever re-measures once real geometry arrives: the child
 * did paint, but the parent's `onFirstPaint` never fires, so its
 * prerendered placeholder overlay never hands off. Re-measuring on every
 * box change self-heals that. Re-posting is safe even when nothing
 * meaningful changed — the parent's `receiveRenderDiagnostic` is a no-op
 * once it has already recorded a paint — and `ResizeObserver`'s native
 * dedup means this only fires on a real size change, not every frame.
 */
export function reportRenderDiagnosticOnResize(
  element: HTMLElement,
  measureAndReport: (element: HTMLElement) => void,
): () => void {
  let resizeObserver: ResizeObserver | undefined;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => measureAndReport(element));
    resizeObserver.observe(element);
  }
  return () => resizeObserver?.disconnect();
}

const attachSurface = modifier<{
  Args: {
    Positional: [
      SandboxSurfaceClient,
      (element: HTMLElement) => void,
      SurfaceHeightMode,
      ((url: string) => Promise<Response>) | undefined,
    ];
  };
  Element: HTMLElement;
}>(
  (
    element,
    [surface, measureAndReportRenderDiagnostic, heightMode, mediaFetch],
  ) => {
    let disconnectEvents = connectSandboxSurface(element, surface, (error) => {
      console.error('Sandbox Surface capability failed', error);
    });
    // Authored `<img>`s lose the user's realm authorization inside this
    // credentialless document; the bridge re-resolves them through the
    // bounded Host media lane. See sandbox-media-bridge.ts.
    let mediaBridge = mediaFetch
      ? new SandboxMediaBridge(element, mediaFetch)
      : undefined;
    mediaBridge?.start();
    // In allocated mode the parent owns the box — a child that keeps
    // reporting intrinsic measurements would stomp the parent's `height:
    // 100%` back to a content-derived pixel value. The mode is derived from
    // tracked state, so a format switch (or a change in the Host's box
    // contract) re-runs this modifier and starts/stops the reporter to match.
    let stopHeightReporting =
      heightMode === 'intrinsic'
        ? reportIntrinsicHeight(element, surface)
        : undefined;
    let stopDiagnosticReporting = reportRenderDiagnosticOnResize(
      element,
      measureAndReportRenderDiagnostic,
    );
    return () => {
      mediaBridge?.stop();
      stopHeightReporting?.();
      stopDiagnosticReporting();
      disconnectEvents();
    };
  },
);

/**
 * RP-20.6 child→parent write leg: forwards authored mutations of the
 * rendered instance to the parent as full save-shaped documents — the exact
 * mirror of the parent's `connectSandboxInstanceSync` (RP-20.5) in the other
 * direction, same dirty-flag + promise-queue coalescing. The subscription is
 * card-api's `subscribeToChanges`, which authored setter mutations fire and
 * an applied parent push (`updateFromSerialized`) deliberately does NOT —
 * that asymmetry, not any suppression flag, is what terminates the sync
 * loop. Send failures are logged, never thrown: the next mutation's write
 * carries full current state, so a missed one self-heals.
 */
export interface SandboxInstanceWriteForwarder {
  flush(): Promise<void>;
  stop(): void;
}

export function coordinateInstanceWrites(
  runtime: DirectBoxelRuntime,
  handle: BoxelInstanceHandle,
  writeClient: SandboxWriteClient,
): SandboxInstanceWriteForwarder {
  let stopped = false;
  let dirty = false;
  let queue = Promise.resolve();
  let active: Promise<void> | undefined;
  let scheduled = false;
  let unsubscribe: (() => void) | undefined;

  let flush = (): Promise<void> => {
    dirty = true;
    if (!scheduled) {
      scheduled = true;
      active = queue.then(async () => {
        while (!stopped && dirty) {
          dirty = false;
          let document = await runtime.serializeInstanceForWrite(handle);
          if (stopped) {
            return;
          }
          await writeClient.write(document);
          // The one child-observable breadcrumb that the parent ACKED
          // applying this write — mirrors '[sandbox-parent] instance push
          // applied'.
          console.debug('[sandbox-child] instance write applied');
        }
      });
      // Keep the internal tail recoverable so one rejected save cannot poison
      // every later mutation, while returning `active` itself to explicit
      // callers so SaveCardTool still observes a parent rejection.
      queue = active
        .catch(() => undefined)
        .finally(() => {
          scheduled = false;
          active = undefined;
          // A mutation can land between the loop's final dirty check and this
          // continuation. Schedule it rather than leaving it stranded.
          if (!stopped && dirty) {
            void flush();
          }
        });
    }
    return active ?? queue;
  };
  let subscriber = () => {
    void flush().catch((error) => {
      console.warn('[sandbox-child] instance write failed', error);
    });
  };
  void runtime.subscribeToInstanceChanges(handle, subscriber).then(
    (unsub) => {
      if (stopped) {
        unsub();
        return;
      }
      unsubscribe = unsub;
    },
    (error) => {
      console.warn('[sandbox-child] instance write subscription failed', error);
    },
  );
  return {
    flush,
    stop() {
      stopped = true;
      unsubscribe?.();
    },
  };
}

export function forwardInstanceWrites(
  runtime: DirectBoxelRuntime,
  handle: BoxelInstanceHandle,
  writeClient: SandboxWriteClient,
): () => void {
  let forwarder = coordinateInstanceWrites(runtime, handle, writeClient);
  return () => forwarder.stop();
}

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
      console.debug('[sandbox-child] dynamic import begun', {
        specifier,
        resolved,
        fromModule: moduleIdentifier,
      });
      return getLoader()
        .import(resolved)
        .then(
          (result) => {
            console.debug('[sandbox-child] dynamic import completed', {
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
  /**
   * RP-9.9: the parent's box contract for this render, carried on the render
   * op. Combined with `format` it decides the height mode — and both sides
   * feed the SAME pair to `surfaceHeightModeFor`, so the parent's layout and
   * this child's decision to measure cannot disagree.
   */
  @tracked private hostOwnsBox = false;
  @tracked private surface?: SandboxSurfaceClient;
  @tracked private error?: Error;
  /**
   * RP-10/RP-9.1 across the boundary: the parent's pushed context snapshot.
   * `undefined` until the first `updateContext` arrives — the same state
   * the Host's own provider is in before realm permissions settle, so Base
   * field editors render disabled until entitlement is known, never the
   * other way around.
   */
  @tracked private contextPermissions?: Permissions;

  private abortBootstrap = new AbortController();
  private loader?: Loader;
  private runtime?: DirectBoxelRuntime;
  private moduleFetchHandler?: (request: Request) => Promise<Response>;
  /** Bounded declarative-asset lane; see SandboxMediaBridge. */
  private mediaFetch?: (url: string) => Promise<Response>;
  private reportRenderDiagnostic?: SandboxRenderDiagnosticReporter;
  /**
   * Resize observation starts as soon as the child render root exists, which
   * is intentionally before the first render request. An empty bootstrap root
   * is not a failed render and must never be reported as one. This bit changes
   * only after a Glimmer flush for an accepted render generation has committed.
   */
  private hasCommittedRender = false;
  /** The handle currently mounted — Sandbox HMR's `draft()` re-derives it. */
  private renderedCardHandle?: BoxelInstanceHandle;
  /** RP-20.6: sender for child→parent instance writes, set at bootstrap. */
  private writeClient?: SandboxWriteClient;
  /** Narrow user-navigation capability; never exposes the Host router. */
  private viewCardClient?: SandboxViewCardClient;
  /** The root is already open. Only nested card registrations navigate. */
  private renderedCardId?: string;
  /** Coordinator for implicit mutations and explicit SaveCardTool flushes. */
  private instanceWriteForwarder?: SandboxInstanceWriteForwarder;
  /**
   * Opaque token accepted only by trusted child-local tool facades. It must
   * exist before the first CardContext provider render; the private-port
   * handshake later installs facades that recognize this same identity.
   */
  private readonly sandboxToolContext = createSandboxToolContext();
  /**
   * RP-17.1 HMR un-deferral: a live check against every generation the
   * parent-facing `SandboxRenderServer` has seen arrive, not just ones
   * already dispatched — wired in by `sandbox-runtime-host.ts` right after
   * that server is constructed (`SandboxRenderTarget.setStaleCheck`'s doc
   * comment). `render`/`draft` re-check it after each internal await so a
   * generation superseded mid-flight bails out rather than applying stale
   * output.
   */
  private isGenerationStale?: (generation: number) => boolean;

  /**
   * A stable (class-field, bound once) reference passed to `attachSurface`
   * so `reportRenderDiagnosticOnResize`'s ResizeObserver installs exactly
   * once for the render root's whole lifetime rather than being torn down
   * and reinstalled on every re-render a fresh closure would cause.
   */
  private measureAndReportRenderDiagnostic = (element: HTMLElement): void => {
    if (
      !this.hasCommittedRender ||
      !this.reportRenderDiagnostic ||
      this.reportRenderDiagnostic.accepted
    ) {
      return;
    }
    this.reportRenderDiagnostic.report(
      measureRenderedOutput(element, this.format),
    );
  };

  /**
   * RP-9.9: the same derivation the parent ran, from the same inputs. Drives
   * both the root's height CSS and whether this child measures itself at all.
   */
  private get heightMode(): SurfaceHeightMode {
    return surfaceHeightModeFor(this.format, this.hostOwnsBox);
  }

  @provide(DefaultFormatsContextName)
  // @ts-ignore "defaultFormat is declared but not used"
  private get defaultFormat() {
    return { cardDef: this.format, fieldDef: this.format };
  }

  @provide(PermissionsContextName)
  // @ts-ignore "permissions is declared but not used"
  private get permissions(): Permissions | undefined {
    return this.contextPermissions;
  }

  /**
   * Base applies this modifier to every nested card container. Main injects
   * ElementTracker here; an origin-isolated child cannot register its DOM in
   * the parent, so it forwards the same semantic identity over the private
   * port instead. This preserves the existing Boxel composition API rather
   * than teaching authored cards about iframes or message channels.
   */
  private cardNavigationModifier = modifier(
    (
      element: Element,
      _positional: never[],
      named: {
        card?: CardDef;
        cardId?: string;
        format: Format | 'data';
        fieldType?: FieldType;
        fieldName?: string;
      },
    ) => {
      let cardId = named.cardId ?? named.card?.id;
      if (
        !(element instanceof HTMLElement) ||
        typeof cardId !== 'string' ||
        cardId === this.renderedCardId
      ) {
        return;
      }
      let click = (event: MouseEvent) => {
        // Match operator-mode overlays: the innermost composed card wins.
        event.stopPropagation();
        // Authored code cannot manufacture Host navigation. A genuine user
        // gesture is the sole way to exercise this UI capability.
        if (!event.isTrusted) {
          return;
        }
        void this.viewCardClient
          ?.viewCard(cardId, named.format, {
            ...(named.fieldType ? { fieldType: named.fieldType } : {}),
            ...(named.fieldName ? { fieldName: named.fieldName } : {}),
          })
          .catch((error) => {
            console.error('Sandbox nested-card navigation failed', error);
          });
      };
      element.addEventListener('click', click);
      element.style.cursor = 'pointer';
      return () => element.removeEventListener('click', click);
    },
  );

  @consume(CardContextName)
  declare private inheritedCardContext: CardContext | undefined;

  private get cardContext(): CardContext {
    // Preserve every capability already provided inside the child. This
    // component only replaces the semantic hook whose implementation must
    // differ across the origin boundary.
    return {
      ...this.inheritedCardContext,
      toolContext: this.sandboxToolContext,
      commandContext: this.sandboxToolContext,
      cardComponentModifier: this
        .cardNavigationModifier as unknown as typeof Modifier,
    } as CardContext;
  }

  private runtimeHost = installSandboxRuntimeHost({
    parentOrigin: this.args.model.parentOrigin,
    bootstrapId: this.args.model.bootstrapId,
    createRuntime: (moduleFetch, mediaFetch, resourceFetch) => {
      this.mediaFetch = mediaFetch;
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
      let loaderFacade: Loader;
      this.loader = new Loader(fetch, this.network.resolveImport, {
        virtualNetwork: this.network.virtualNetwork,
        moduleEvaluator: createSandboxModuleEvaluator(() => this.loader!),
        moduleMeta: (moduleIdentifier) => ({
          url: moduleIdentifier,
          loader: loaderFacade,
        }),
      });
      // Static and dynamic imports remain on the classified module graph.
      // Only authored `fetch()` (rewritten by loaderPlugin to
      // `import.meta.loader.fetch()`) receives the projected-resource lane.
      // A denied Host grant falls back to the child origin's credentialless
      // native fetch, preserving ordinary public CORS resources without
      // broadening authenticated Realm access.
      let authoredFetch: typeof globalThis.fetch = async (input, init) => {
        try {
          return await resourceFetch(input, init);
        } catch {
          return globalThis.fetch(input, {
            ...init,
            credentials: 'omit',
          });
        }
      };
      loaderFacade = new Proxy(this.loader, {
        get(target, property) {
          if (property === 'fetch') {
            return authoredFetch;
          }
          let value = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      installBoxelLoaderCompatibilityModules(this.loader);
      installSandboxToolCompatibilityModules(
        [this.network.virtualNetwork, this.loader],
        {
          saveCard: (card, realm) => this.saveRenderedCard(card, realm),
        },
        this.sandboxToolContext,
      );
      let store = new CardStoreWithGarbageCollection(
        new Map(),
        fetch,
        this.network.virtualNetwork,
      );
      this.runtime = new DirectBoxelRuntime(
        // Use the canonical Base URL here, matching the module identity that
        // authored card sources import. Loading the package alias separately
        // can produce two Base module instances inside the child: the card's
        // Field objects then write query/deserialization state into one module
        // registry while DirectBoxelRuntime reads another. One canonical
        // identity keeps the runtime adapter and rendered card on the same
        // Card API, just as the Host's ordinary Loader does.
        // eslint-disable-next-line @cardstack/boxel/no-url-form-base-imports -- the Sandbox must share authored cards' canonical Base module identity
        () => this.loader!.import('https://cardstack.com/base/card-api'),
        () => this.loader!,
        undefined,
        store,
      );
      return this.runtime;
    },
    createRenderTarget: (
      _runtime,
      surface,
      reportRenderDiagnostic,
      writeClient,
      viewCardClient,
    ) => {
      join(() => (this.surface = surface));
      this.reportRenderDiagnostic = reportRenderDiagnostic;
      this.writeClient = writeClient;
      this.viewCardClient = viewCardClient;
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
    render: async (
      card: BoxelInstanceHandle,
      format: string,
      generation: number,
      hostOwnsBox?: boolean,
    ) => {
      // Breadcrumb 6/7: the render-transport dispatcher (sandbox-render-
      // transport.ts, parent-owned) called this the moment it received the
      // render request off the wire — this is the earliest point in the
      // sandboxed render path this component itself can observe, so it
      // stands in for "render request received".
      console.debug('[sandbox-child] render begun', {
        card,
        format,
        generation,
      });
      if (!this.runtime) {
        throw new Error('Sandbox runtime is unavailable');
      }
      this.renderedCardId = this.runtime.getInstanceId(card);
      // Some authored cards size a canvas or renderer exactly once from
      // their mount point's geometry, with no ResizeObserver of their own
      // (a reasonable assumption on main, where a card only ever mounts at
      // real size — see mountFabrication-style modifiers). The Sandbox
      // tier cannot make that same promise on its own: this iframe can boot
      // — and be asked to render — before its ancestor slot in the parent
      // document has finished laying out, most visibly on a page reload.
      // reportRenderDiagnosticOnResize (installed by attachSurface) can
      // detect a paint that happened at zero size after the fact, but by
      // then a one-shot-sized renderer already baked in the wrong
      // dimensions — there is nothing to re-measure into. So the card's
      // component must not mount at all until real geometry exists.
      let root = document.querySelector<HTMLElement>(
        '[data-boxel-sandbox-runtime]',
      );
      if (root) {
        await whenNonzeroSize(root);
      }
      // RP-17.1 HMR un-deferral: re-check after the await above — a newer
      // render/draft may already be queued behind this one.
      if (this.isGenerationStale?.(generation)) {
        return;
      }
      this.renderedCardHandle = card;
      this.installWriteForwarder(card);
      let slot = this.runtime.getRenderSlotForHandle(card);
      join(() => {
        this.format = format as Format;
        this.hostOwnsBox = hostOwnsBox ?? false;
        this.renderedComponent =
          slot.component as ComponentLike<SandboxComponentSignature>;
        this.error = undefined;
      });
      await afterRender();
      if (this.isGenerationStale?.(generation)) {
        return;
      }
      this.hasCommittedRender = true;
      // Breadcrumb 7/7: the Glimmer flush this awaited has committed —
      // report what actually landed in the DOM. The render-response ack
      // (sandbox-render-transport.ts) only proves this promise resolved,
      // not that anything visible came out of it.
      if (
        this.reportRenderDiagnostic &&
        !this.reportRenderDiagnostic.accepted
      ) {
        let diagnostic = measureRenderedOutput(root, format);
        console.debug('[sandbox-child] render completed', diagnostic);
        this.reportRenderDiagnostic.report(diagnostic);
      }
    },
    clear: async (generation: number) => {
      if (this.isGenerationStale?.(generation)) {
        return;
      }
      join(() => {
        this.renderedComponent = undefined;
        this.error = undefined;
      });
      this.hasCommittedRender = false;
      this.renderedCardHandle = undefined;
      this.instanceWriteForwarder?.stop();
      this.instanceWriteForwarder = undefined;
      await afterRender();
    },
    updateInstance: async (
      document: LooseSingleCardDocument,
      generation: number,
    ) => {
      // RP-20.5 parent→child push: apply the canonical instance's fresh
      // serialized state to the mounted child copy IN PLACE
      // (DirectBoxelRuntime.updateInstanceDocument → updateFromSerialized).
      // The component and DOM survive — the child's own tracking re-renders
      // the changed bindings, exactly like a store reload on main. No
      // renderedComponent/error state is touched: a failing apply rethrows
      // and the render server acks ok:false while the last-known-good DOM
      // stays up.
      if (!this.runtime || !this.renderedCardHandle) {
        throw new Error(
          'Sandbox instance update requires an already-rendered card',
        );
      }
      let renderedId = document?.data?.id;
      if (typeof renderedId !== 'string' || renderedId.length === 0) {
        throw new Error('Sandbox instance update requires a card id');
      }
      await this.runtime.updateInstanceDocument(
        this.renderedCardHandle,
        document,
      );
      if (this.isGenerationStale?.(generation)) {
        return;
      }
      await afterRender();
    },
    updateContext: async (
      permissions: { canRead: boolean; canWrite: boolean } | null,
      generation: number,
    ) => {
      // RP-10/RP-9.1: apply the parent's context snapshot. Tracked, so the
      // provider getter above re-renders every consumer (Base field editors
      // flip enabled/disabled) in place — no remount, no render-state touch.
      if (this.isGenerationStale?.(generation)) {
        return;
      }
      join(() => {
        this.contextPermissions = permissions ?? undefined;
      });
      await afterRender();
    },
    draft: async (url: string, generation: number) => {
      // Sandbox HMR (RP-17.1 un-deferral, dossier step 2): invalidate only
      // the edited module (Loader.invalidateModule is already surgical —
      // reverse dependants only, everything else stays cached) and
      // re-derive the currently mounted card from the SAME serialized
      // document (DirectBoxelRuntime.redeserialize) — data state survives;
      // only module/component identity changes. Never touches
      // this.renderedComponent/this.error before that succeeds, so a
      // failure here (a syntax error in the edit, a throwing class body)
      // leaves the last-known-good render exactly as it was — this method
      // simply rethrows, and SandboxRenderServer's own queue turns that
      // into an `ok:false` ack without this component ever clearing
      // anything. The child never re-enters the placeholder for an
      // ordinary HMR generation either: `this.painted`
      // (sandbox-runtime-process.ts) is untouched by any of this, so
      // onFirstPaint (already fired once) never re-arms.
      console.debug('[sandbox-child] draft begun', { url, generation });
      if (!this.runtime || !this.renderedCardHandle) {
        throw new Error(
          'Sandbox draft requires an already-rendered card to redraft',
        );
      }
      this.loader?.invalidateModule(url);
      await this.runtime.redeserialize(this.renderedCardHandle);
      if (this.isGenerationStale?.(generation)) {
        return;
      }
      let slot = this.runtime.getRenderSlotForHandle(this.renderedCardHandle);
      let root = document.querySelector<HTMLElement>(
        '[data-boxel-sandbox-runtime]',
      );
      if (root) {
        await whenNonzeroSize(root);
      }
      if (this.isGenerationStale?.(generation)) {
        return;
      }
      // redeserialize() replaced the instance UNDER the same handle — the
      // write subscription is bound to the old instance object, so it must
      // be re-installed against the replacement (RP-20.6).
      this.installWriteForwarder(this.renderedCardHandle);
      join(() => {
        this.renderedComponent =
          slot.component as ComponentLike<SandboxComponentSignature>;
        this.error = undefined;
      });
      await afterRender();
      if (this.isGenerationStale?.(generation)) {
        return;
      }
      if (
        this.reportRenderDiagnostic &&
        !this.reportRenderDiagnostic.accepted
      ) {
        let diagnostic = measureRenderedOutput(root, this.format);
        console.debug('[sandbox-child] draft completed', diagnostic);
        this.reportRenderDiagnostic.report(diagnostic);
      }
    },
    setStaleCheck: (isStale) => {
      this.isGenerationStale = isStale;
    },
  };

  private installWriteForwarder(card: BoxelInstanceHandle): void {
    this.instanceWriteForwarder?.stop();
    this.instanceWriteForwarder =
      this.runtime && this.writeClient
        ? coordinateInstanceWrites(this.runtime, card, this.writeClient)
        : undefined;
  }

  private async saveRenderedCard(card: unknown, realm?: string) {
    if (
      !this.runtime ||
      !this.renderedCardHandle ||
      !this.instanceWriteForwarder
    ) {
      throw new Error('Sandbox save requires an already-rendered Boxel');
    }
    let renderedId = this.runtime.getInstanceId(this.renderedCardHandle);
    let requestedId =
      typeof card === 'object' && card !== null && 'id' in card
        ? card.id
        : undefined;
    if (
      typeof renderedId !== 'string' ||
      renderedId.length === 0 ||
      requestedId !== renderedId
    ) {
      throw new Error(
        'Sandbox SaveCardTool can save only the Boxel rendered by this process',
      );
    }
    if (realm !== undefined && !renderedId.startsWith(realm)) {
      throw new Error(
        'Sandbox SaveCardTool cannot move a Boxel to a different realm',
      );
    }
    await this.instanceWriteForwarder.flush();
    return card;
  }

  willDestroy(): void {
    super.willDestroy();
    this.instanceWriteForwarder?.stop();
    this.instanceWriteForwarder = undefined;
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
    <ContextProvider @key={{CardContextName}} @value={{this.cardContext}}>
      {{#if this.error}}
        <p class='boxel-sandbox-runtime__error' role='alert'>
          {{this.error.message}}
        </p>
      {{else if this.surface}}
        <main
          class='boxel-sandbox-runtime boxel-sandbox-runtime--{{this.format}}
            boxel-sandbox-runtime--{{this.heightMode}}'
          data-boxel-sandbox-runtime
          {{attachSurface
            this.surface
            this.measureAndReportRenderDiagnostic
            this.heightMode
            this.mediaFetch
          }}
        >
          {{#if this.renderedComponent}}
            <this.renderedComponent
              @format={{this.format}}
              @context={{this.cardContext}}
            />
          {{/if}}
        </main>
      {{/if}}
    </ContextProvider>
    <style scoped>
      :global(html),
      :global(body) {
        margin: 0;
        background: transparent;
      }

      .boxel-sandbox-runtime {
        width: 100%;
        /* The root itself never scrolls — content flows at natural height
          so the intrinsic measurement reads the content's true demand, and
          collapsing-margin/scrollbar noise can't leak into it. Once the
          parent has applied the reported height, this document's own <html>
          scrolls anything past the intrinsic clamp ceiling. */
        overflow: hidden;
        min-height: 2.5rem;
      }

      /* An isolated card is a full page: even while its content is still
        streaming in, it should claim at least the viewport the parent gave
        the iframe (100vh here IS that iframe's height), exactly like an
        in-document stack item. */
      .boxel-sandbox-runtime--isolated {
        min-height: 100vh;
      }

      /* Allocated mode (RP-9.9): someone above sized this iframe — a fitted
        tile's owner, or a Host slot with a definite box. Fill that viewport
        with a DEFINITE height, not a minimum: a card root styled
        height: 100% resolves its percentage only against a definite
        containing block, and resolves to auto (i.e. collapses to its own
        content) against a min-height. That collapse is what left full-page
        cards rendering at ~60px. */
      .boxel-sandbox-runtime--allocated {
        height: 100vh;
      }

      /* Main places the caller's `stack-item-preview` class directly on the
        CardContainer, where it supplies `overflow: auto`. A cross-origin
        Sandbox cannot move that Host class through the document boundary,
        so allocated surfaces reproduce the same box contract here: the
        immediate Boxel container fills the child viewport and owns scrolling.
        The full selector is global because this dynamically-rendered child
        does not carry this template's scoped-CSS attribute. It remains
        confined to the separate Sandbox document. */
      :global(
        [data-boxel-sandbox-runtime].boxel-sandbox-runtime--allocated
          > .boxel-card-container
      ) {
        height: 100%;
        min-height: 0;
        overflow: auto;
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

function elementHasSize(element: Element): boolean {
  let rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * Resolves once `element`'s own box is nonzero — immediately if it already
 * is. See the comment at this function's call site (the render-transport
 * `render()` above) for why the card's first mount must wait for this
 * rather than merely re-measuring after the fact.
 *
 * Bounded: an ancestor that genuinely never gains real geometry (a
 * collapsed or actually-hidden slot, not just one still mid an opening
 * transition) must not hang the render forever — this gives up and
 * resolves anyway after `timeoutMs`, at whatever size exists. A render
 * that lands at that point can still self-heal for cards that DO react to
 * a later resize, via `reportRenderDiagnosticOnResize`; a card that (like
 * the class of card this exists for) sizes itself once at mount and never
 * again would still measure zero — the best this bounded wait can do
 * without a signal that geometry is intentionally, permanently zero.
 */
export function whenNonzeroSize(
  element: Element,
  timeoutMs = 4000,
): Promise<void> {
  if (elementHasSize(element)) {
    return Promise.resolve();
  }
  if (typeof ResizeObserver === 'undefined') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof globalThis.setTimeout>;
    let observer: ResizeObserver;
    let settle = () => {
      if (settled) {
        return;
      }
      settled = true;
      observer.disconnect();
      globalThis.clearTimeout(timer);
      resolve();
    };
    observer = new ResizeObserver(() => {
      if (elementHasSize(element)) {
        settle();
      }
    });
    observer.observe(element);
    timer = globalThis.setTimeout(settle, timeoutMs);
  });
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
