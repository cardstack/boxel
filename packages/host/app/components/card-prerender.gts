import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import type {
  RouteInfo,
  RouteInfoWithAttributes,
} from '@ember/routing/-internals';
import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';

import { isTesting } from '@embroider/macros';

import Component from '@glimmer/component';

import { didCancel, enqueueTask } from 'ember-concurrency';

import {
  baseRef,
  CardError,
  internalKeysFor,
  SupportedMimeType,
  type CardErrorsJSONAPI,
  type LooseSingleCardDocument,
  type RenderError,
  type ModuleRenderResponse,
  type FileExtractResponse,
  type PrerenderVisitArgs,
  type RenderVisitResponse,
  type Prerenderer,
  type RunCommandArgs,
  type RunCommandResponse,
  type Format,
  type FusedIndexMeta,
  type PrerenderMeta,
  type RenderRouteOptions,
  VISIT_PASS_ORDER,
  serializeRenderRouteOptions,
  cleanCapturedHTML,
  snapshotRuntimeDependencies,
} from '@cardstack/runtime-common';

import { readFileAsText as _readFileAsText } from '@cardstack/runtime-common/stream';

import {
  buildModuleModel,
  type ModuleModelContext,
  type ModuleModelState,
  type ModuleTypesCache,
} from '../routes/module';

import { createAuthErrorGuard } from '../utils/auth-error-guard';
import { REALM_INDEX_BOILERPLATE_HTML } from '../utils/realm-index-boilerplate';
import {
  RenderCardTypeTracker,
  type CardRenderContext,
  deriveCardTypeFromDoc,
} from '../utils/render-error';
import {
  enableRenderTimerStub,
  withTimersBlocked,
} from '../utils/render-timer-stub';

import type { Model as HtmlRouteModel } from '../routes/render/html';

import type LoaderService from '../services/loader-service';
import type LocalIndexer from '../services/local-indexer';
import type NetworkService from '../services/network';
import type RenderService from '../services/render-service';
import type RenderStoreService from '../services/render-store';

// This component is used to perform rendering for indexing in Ember test contexts
export default class CardPrerender extends Component {
  @service('render-store') declare private store: RenderStoreService;
  @service declare private network: NetworkService;
  @service declare private router: RouterService;
  @service declare private renderService: RenderService;
  @service declare private localIndexer: LocalIndexer;
  @service declare private loaderService: LoaderService;
  #nonce = 0;
  #shouldClearCacheForNextRender = true;
  #prerendererDelegate!: Prerenderer;
  #cardTypeTracker = new RenderCardTypeTracker();
  #currentContext: CardRenderContext | undefined;
  #moduleTypesCache: ModuleTypesCache = new WeakMap() as ModuleTypesCache;
  #moduleLastStoreResetKey: string | undefined;
  #moduleAuthGuard = createAuthErrorGuard();

  #renderBasePath(url: string, renderOptions?: RenderRouteOptions) {
    let optionsSegment = encodeURIComponent(
      serializeRenderRouteOptions(renderOptions ?? {}),
    );
    return `/render/${encodeURIComponent(url)}/${
      this.#nonce
    }/${optionsSegment}`;
  }

  constructor(owner: Owner, args: {}) {
    super(owner, args);
    this.#moduleAuthGuard.register();
    this.#prerendererDelegate = {
      prerenderModule: this.prerenderModule.bind(this),
      prerenderVisit: this.prerenderVisitPublic.bind(this),
      runCommand: this.runCommand.bind(this),
    };
    this.localIndexer.setup(this.#prerendererDelegate);
    registerDestructor(this, () => {
      this.localIndexer.teardown(this.#prerendererDelegate);
      this.#cardTypeTracker.clear();
      this.#moduleTypesCache = new WeakMap() as ModuleTypesCache;
      this.#moduleLastStoreResetKey = undefined;
      this.#currentContext = undefined;
      this.#moduleAuthGuard.unregister();
    });
  }

  private async prerenderModule({
    url,
    realm,
    auth,
    renderOptions,
  }: {
    realm: string;
    url: string;
    auth: string;
    renderOptions?: RenderRouteOptions;
  }): Promise<ModuleRenderResponse> {
    return await withRenderContext(async () => {
      try {
        let run = () =>
          this.modulePrerenderTask.perform({
            url,
            realm,
            auth,
            renderOptions,
          });
        return isTesting() ? await run() : await withTimersBlocked(run);
      } catch (e: any) {
        if (!didCancel(e)) {
          throw e;
        }
      }
      throw new Error(
        `card-prerender component is missing or being destroyed before module prerender of url ${url} was completed`,
      );
    });
  }

  private async prerenderVisitPublic(
    args: PrerenderVisitArgs,
  ): Promise<RenderVisitResponse> {
    return await withRenderContext(async () => {
      try {
        let run = () => this.prerenderVisitTask.perform(args);
        return isTesting() ? await run() : await withTimersBlocked(run);
      } catch (e: any) {
        if (!didCancel(e)) {
          throw e;
        }
      }
      throw new Error(
        `card-prerender component is missing or being destroyed before visit prerender of url ${args.url} was completed`,
      );
    });
  }

  private async runCommand(_args: RunCommandArgs): Promise<RunCommandResponse> {
    return {
      status: 'error',
      error: 'runCommand is not supported by the card-prerender delegate',
    };
  }

  private modulePrerenderTask = enqueueTask(
    async ({
      url,
      renderOptions,
    }: {
      realm: string;
      url: string;
      auth: string;
      renderOptions?: RenderRouteOptions;
    }): Promise<ModuleRenderResponse> => {
      this.#nonce++;
      let shouldClearCache = this.#consumeClearCacheForRender(
        Boolean(renderOptions?.clearCache),
      );
      let initialRenderOptions: RenderRouteOptions = {
        ...(renderOptions ?? {}),
      };
      if (shouldClearCache) {
        initialRenderOptions.clearCache = true;
      } else {
        delete initialRenderOptions.clearCache;
      }

      let result = await buildModuleModel(
        {
          id: url,
          nonce: String(this.#nonce),
          renderOptions: initialRenderOptions,
        },
        this.#moduleModelContext(),
      );
      return result as ModuleRenderResponse;
    },
  );

  // Composite visit task — runs the caller-selected subset of
  // {fileExtract, cardRender, fileRender} in one visit with a single
  // clearCache consumption; each pass takes its own nonce so the render
  // route's model cache keys them distinctly. Mirrors the server-side
  // prerenderVisitAttempt, including its visitType bifurcation: an 'index'
  // visit of a card instance runs the fused meta entry (which carries the
  // file extract) plus the card's and the file's icons — never an
  // html-format render; a non-card index visit runs the standalone extract;
  // a 'prerender-html' visit runs only the html formats + markdown. No
  // visitType runs the fused union.
  private prerenderVisitTask = enqueueTask(
    async ({
      url,
      visitType,
      renderOptions,
      fileData,
      types,
      cardTypes,
    }: PrerenderVisitArgs): Promise<RenderVisitResponse> => {
      this.#nonce++;
      // Clear any residual render error from a previous visit so the earliest
      // pass (fileExtract) doesn't falsely throw on stale state.
      this.localIndexer.renderError = undefined;
      this.localIndexer.prerenderStatus = 'loading';
      let shouldClearCache = this.#consumeClearCacheForRender(
        Boolean(renderOptions?.clearCache),
      );
      let baseOptions: RenderRouteOptions = { ...(renderOptions ?? {}) };
      let runIndexSteps = visitType !== 'prerender-html';
      let runHtmlSteps = visitType !== 'index';
      let requested = {
        // The extract belongs to the index half; a prerender-html visit
        // never runs it even when the flag rides along on shared options.
        fileExtract: Boolean(baseOptions.fileExtract) && runIndexSteps,
        cardRender: Boolean(baseOptions.cardRender),
        fileRender: Boolean(baseOptions.fileRender),
      };
      // A card-instance index visit fuses the extract into the render.meta
      // entry — one route entry produces both the instance row and the file
      // row — mirroring the server-side runner. No capability probe is
      // needed: this driver and the render routes ship in the same build.
      let fusedIndexPass =
        visitType === 'index' && requested.cardRender && requested.fileExtract;
      if (fusedIndexPass) {
        requested.fileExtract = false;
      }
      if (shouldClearCache) {
        this.loaderService.resetLoader({
          clearFetchCache: true,
          reason: 'card-prerender visit clearCache',
        });
        this.store.resetCache();
      }
      let clearCacheConsumed = !shouldClearCache;
      let optionsForPass = (
        pass: 'fileExtract' | 'cardRender' | 'fileRender' | 'fusedIndex',
      ): RenderRouteOptions => {
        let out: RenderRouteOptions = {
          ...baseOptions,
          // The fused index pass carries both flags — the render route
          // serves it from the card branch and folds the file extract into
          // the render.meta payload.
          fileExtract:
            pass === 'fileExtract' || pass === 'fusedIndex' ? true : undefined,
          cardRender:
            pass === 'cardRender' || pass === 'fusedIndex' ? true : undefined,
          fileRender: pass === 'fileRender' ? true : undefined,
        };
        if (!clearCacheConsumed) {
          out.clearCache = true;
          clearCacheConsumed = true;
        } else {
          delete out.clearCache;
        }
        for (let key of Object.keys(out) as (keyof RenderRouteOptions)[]) {
          if (out[key] === undefined) {
            delete out[key];
          }
        }
        return out;
      };

      let response: RenderVisitResponse = {};

      // Iterate in canonical VISIT_PASS_ORDER. This import exists only to tie
      // the browser-side order to the server-side order — the actual branching
      // is explicit below.
      void VISIT_PASS_ORDER;

      // Runs a standalone render.file-extract route entry and stores its
      // result on `response.fileExtract`. Serves the fileExtract pass and
      // the fused-index fallback (a card render error must still yield a
      // file row). Self-contained: bumps the nonce and clears any earlier
      // pass's render error so it keys and captures independently of
      // whatever ran before it.
      let runFileExtractPass = async () => {
        this.#nonce++;
        this.localIndexer.renderError = undefined;
        let passOptions = optionsForPass('fileExtract');
        try {
          let routeInfo = await this.router.recognizeAndLoad(
            `${this.#renderBasePath(url, passOptions)}/file-extract`,
          );
          if (this.localIndexer.renderError) {
            throw new Error(this.localIndexer.renderError);
          }
          await this.#ensureRenderReady(routeInfo);
          response.fileExtract = routeInfo.attributes as FileExtractResponse;
        } catch (e: any) {
          let renderError: RenderError;
          try {
            renderError = {
              ...JSON.parse(e.message),
              type: 'file-error',
            };
          } catch {
            let cardErr = new CardError(e.message);
            cardErr.stack = e.stack;
            renderError = {
              error: {
                ...cardErr.toJSON(),
                deps: [url],
                additionalErrors: null,
              },
              type: 'file-error',
            };
          }
          response.fileExtract = {
            id: url,
            nonce: String(this.#nonce),
            status: 'error',
            searchDoc: null,
            deps: renderError.error.deps ?? [],
            error: renderError,
          };
          // fileExtract errors are route-level errors, not page-unusable
          // errors. Populate the sub-response but continue on to any
          // requested cardRender/fileRender passes so they can still
          // capture their own results. The server-side orchestrator
          // behaves the same way — only genuine page-unusable conditions
          // (eviction, auth failure) short-circuit the visit.
        }
      };

      // ── fileExtract pass ───────────────────────────────────────────────
      if (requested.fileExtract) {
        await runFileExtractPass();
      }

      // ── cardRender pass ────────────────────────────────────────────────
      if (requested.cardRender) {
        // Bump nonce between passes so the render route's model cache keys
        // them distinctly — matches the separate-task behavior in the legacy
        // paths and avoids subtle model/store lifecycle issues from reusing
        // the same nonce across passes with different options.
        this.#nonce++;
        let context: CardRenderContext = {
          cardId: url.replace(/\.json$/, ''),
          nonce: String(this.#nonce),
        };
        this.#currentContext = context;
        this.localIndexer.renderError = undefined;
        this.localIndexer.prerenderStatus = 'loading';
        let initialRenderOptions = optionsForPass(
          fusedIndexPass ? 'fusedIndex' : 'cardRender',
        );
        let cardError: RenderError | undefined;
        let isolatedHTML: string | null = null;
        let headHTML: string | null = null;
        let atomHTML: string | null = null;
        let iconHTML: string | null = null;
        let embeddedHTML: Record<string, string> | null = null;
        let fittedHTML: Record<string, string> | null = null;
        let markdown: string | null = null;
        let capturedDeps: string[] | null = null;
        let meta: PrerenderMeta = {
          serialized: null,
          searchDoc: null,
          displayNames: null,
          deps: null,
          types: null,
        };
        try {
          await this.#primeCardType(url, context);
          let subsequentRenderOptions =
            omitOneTimeOptions(initialRenderOptions);
          if (runHtmlSteps) {
            isolatedHTML = await this.renderHTML.perform(
              url,
              'isolated',
              0,
              initialRenderOptions,
            );
            if (visitType === 'prerender-html') {
              // The card's runtime deps normally ride on render.meta, which
              // a prerender-html visit never runs. Snapshot the tracking
              // session directly after the isolated render settles so the
              // HTML rendering still reports what it pulled in — the
              // indexing job unions this with the index visit's meta deps.
              capturedDeps = this.network.virtualNetwork.unresolveURLs(
                snapshotRuntimeDependencies({ excludeQueryOnly: true }).deps,
              );
            }
          }
          if (runIndexSteps) {
            let metaResult = (await this.renderMeta.perform(
              url,
              runHtmlSteps ? subsequentRenderOptions : initialRenderOptions,
            )) as FusedIndexMeta | undefined;
            // Split the extract off before `meta` is spread into
            // `response.card` below — the card row's payload must never
            // carry the file half. The meta route's abort path resolves
            // with no payload; falling back to the empty meta keeps that
            // producing an empty card payload rather than a throw.
            let { fileExtract: fusedExtract, ...cardMeta } = (metaResult ??
              meta) as FusedIndexMeta;
            meta = cardMeta;
            if (fusedExtract) {
              response.fileExtract = fusedExtract;
            }
          }
          if (runHtmlSteps) {
            headHTML = await this.renderHTML.perform(
              url,
              'head',
              0,
              subsequentRenderOptions,
            );
            atomHTML = await this.renderHTML.perform(
              url,
              'atom',
              0,
              subsequentRenderOptions,
            );
          }
          if (runIndexSteps) {
            iconHTML = await this.renderIcon.perform(
              url,
              subsequentRenderOptions,
            );
          }
          if (runHtmlSteps) {
            markdown = await this.renderHTML.perform(
              url,
              'markdown',
              0,
              subsequentRenderOptions,
            );
            // The ancestor type chain drives the fitted/embedded renders. A
            // prerender-html visit takes the chain the caller passed (the
            // indexing job forwards the index visit's types) and resolves it
            // itself via render.meta only as a fallback; the fused visit
            // already holds it from the meta step above.
            let typesForAncestors = runIndexSteps
              ? meta?.types
              : cardTypes?.length
                ? cardTypes
                : (await this.renderMeta.perform(url, subsequentRenderOptions))
                    ?.types;
            if (typesForAncestors) {
              embeddedHTML = await this.renderAncestors.perform(
                url,
                'embedded',
                typesForAncestors,
                subsequentRenderOptions,
              );
              fittedHTML = await this.renderAncestors.perform(
                url,
                'fitted',
                typesForAncestors,
                subsequentRenderOptions,
              );
            }
          }
        } catch (e: any) {
          try {
            cardError = { ...JSON.parse(e.message), type: 'instance-error' };
          } catch (_err) {
            let cardErr = new CardError(e.message);
            cardErr.stack = e.stack;
            cardError = {
              error: {
                ...cardErr.toJSON(),
                deps: [url.replace(/\.json$/, '')],
                additionalErrors: null,
              },
              type: 'instance-error',
            };
          }
          // Plant cardType from the source-derived tracker if the upstream
          // error payload didn't carry it. Without this, errored rows have
          // search_doc._cardType=null and the cards-grid "All Cards" filter
          // (not eq _cardType=Cards Grid) excludes them — invisible errors
          // that the user can never click into.
          if (cardError && !cardError.cardType) {
            let primed = this.#cardTypeTracker.get(context);
            if (primed) {
              cardError.cardType = primed;
            }
          }
          this.store.resetCache();
        } finally {
          this.#cardTypeTracker.set(context, undefined);
          if (this.#currentContext === context) {
            this.#currentContext = undefined;
          }
        }
        if (this.localIndexer.prerenderStatus === 'loading') {
          this.localIndexer.prerenderStatus = 'ready';
        }
        response.card = {
          ...meta,
          ...(capturedDeps ? { deps: capturedDeps } : {}),
          isolatedHTML,
          headHTML,
          atomHTML,
          embeddedHTML,
          fittedHTML,
          iconHTML,
          markdown,
          ...(cardError ? { error: cardError } : {}),
        };

        // ── fused-extract fallback ─────────────────────────────────────
        // A fused index pass carries the file extract inside render.meta,
        // so a card render error leaves the file half missing. Run the
        // standalone extract entry — a broken card must still yield a good
        // file row.
        if (fusedIndexPass && !response.fileExtract) {
          await runFileExtractPass();
        }
      }

      // ── fileRender pass ────────────────────────────────────────────────
      if (requested.fileRender) {
        // Bump nonce between passes (see cardRender pass for rationale).
        this.#nonce++;
        // Start the pass clean, like fileExtract/cardRender — a render error
        // from an earlier pass must not be re-thrown by this one.
        this.localIndexer.renderError = undefined;
        let effectiveFileData =
          fileData ??
          (response.fileExtract?.resource && baseOptions.fileDefCodeRef
            ? {
                resource: response.fileExtract.resource,
                fileDefCodeRef: baseOptions.fileDefCodeRef,
              }
            : undefined);
        let effectiveTypes = types ?? response.fileExtract?.types ?? undefined;
        if (!effectiveFileData) {
          response.fileRender = {
            isolatedHTML: null,
            headHTML: null,
            atomHTML: null,
            embeddedHTML: null,
            fittedHTML: null,
            iconHTML: null,
            markdown: null,
            error: {
              type: 'file-error',
              error: {
                message:
                  'prerenderVisit requested fileRender pass without fileData',
                status: 500,
                additionalErrors: null,
              },
            },
          };
        } else {
          let initialRenderOptions: RenderRouteOptions = {
            ...optionsForPass('fileRender'),
            fileDefCodeRef: effectiveFileData.fileDefCodeRef,
          };
          (globalThis as any).__boxelFileRenderData = effectiveFileData;

          let fileError: RenderError | undefined;
          let isolatedHTML: string | null = null;
          let headHTML: string | null = null;
          let atomHTML: string | null = null;
          let iconHTML: string | null = null;
          let embeddedHTML: Record<string, string> | null = null;
          let fittedHTML: Record<string, string> | null = null;
          let markdown: string | null = null;

          try {
            let subsequentRenderOptions =
              omitOneTimeOptions(initialRenderOptions);
            if (runHtmlSteps) {
              isolatedHTML = await this.renderHTML.perform(
                url,
                'isolated',
                0,
                initialRenderOptions,
              );
              headHTML = await this.renderHTML.perform(
                url,
                'head',
                0,
                subsequentRenderOptions,
              );
              atomHTML = await this.renderHTML.perform(
                url,
                'atom',
                0,
                subsequentRenderOptions,
              );
            }
            if (runIndexSteps) {
              // The file's icon belongs to the index half; in an index visit
              // it is the pass's only render.
              iconHTML = await this.renderIcon.perform(
                url,
                runHtmlSteps ? subsequentRenderOptions : initialRenderOptions,
              );
            }
            if (runHtmlSteps) {
              markdown = await this.renderHTML.perform(
                url,
                'markdown',
                0,
                subsequentRenderOptions,
              );
              if (effectiveTypes?.length) {
                embeddedHTML = await this.renderAncestors.perform(
                  url,
                  'embedded',
                  effectiveTypes,
                  subsequentRenderOptions,
                );
                fittedHTML = await this.renderAncestors.perform(
                  url,
                  'fitted',
                  effectiveTypes,
                  subsequentRenderOptions,
                );
              }
            }
          } catch (e: any) {
            try {
              fileError = { ...JSON.parse(e.message), type: 'file-error' };
            } catch (_err) {
              let cardErr = new CardError(e.message);
              cardErr.stack = e.stack;
              fileError = {
                error: {
                  ...cardErr.toJSON(),
                  deps: [url],
                  additionalErrors: null,
                },
                type: 'file-error',
              };
            }
            this.store.resetCache();
          } finally {
            delete (globalThis as any).__boxelFileRenderData;
          }

          response.fileRender = {
            isolatedHTML,
            headHTML,
            atomHTML,
            embeddedHTML,
            fittedHTML,
            iconHTML,
            markdown,
            ...(fileError ? { error: fileError } : {}),
          };
        }
      }

      return response;
    },
  );

  #moduleModelContext(): ModuleModelContext {
    return {
      router: this.router,
      store: this.store,
      loaderService: this.loaderService,
      network: this.network,
      authGuard: this.#moduleAuthGuard,
      state: this.#moduleModelState(),
      owner: this,
    };
  }

  #moduleModelState(): ModuleModelState {
    return {
      getTypesCache: () => this.#moduleTypesCache,
      setTypesCache: (cache) => (this.#moduleTypesCache = cache),
      getLastStoreResetKey: () => this.#moduleLastStoreResetKey,
      setLastStoreResetKey: (key) => {
        this.#moduleLastStoreResetKey = key;
      },
    };
  }

  private renderHTML = enqueueTask(
    async (
      url: string,
      format: Format,
      ancestorLevel = 0,
      renderOptions?: RenderRouteOptions,
    ) => {
      let routeInfo = await this.router.recognizeAndLoad(
        `${this.#renderBasePath(
          url,
          renderOptions,
        )}/html/${format}/${ancestorLevel}`,
      );
      if (this.localIndexer.renderError) {
        throw new Error(this.localIndexer.renderError);
      }
      // The html sub-route flags this when the card is the realm's
      // default CardsGrid index and the realm has not opted in to
      // keeping its prerendered isolated HTML. Short-circuit the
      // Glimmer render entirely and return the boilerplate so the
      // indexer pays a constant write cost regardless of realm size.
      if (
        format === 'isolated' &&
        ancestorLevel === 0 &&
        (routeInfo.attributes as HtmlRouteModel).useRealmIndexBoilerplate
      ) {
        await this.#ensureRenderReady(routeInfo);
        return REALM_INDEX_BOILERPLATE_HTML;
      }
      let component = routeInfo.attributes.Component;
      let captureMode: 'innerHTML' | 'outerHTML' | 'textContent';
      if (format === 'markdown') {
        // Mirror realm-server puppeteer capture: markdown renders into a
        // whitespace-preserving container; capturing textContent avoids
        // polluting the markdown column with wrapper HTML (e.g. the
        // "markdown-format" CSS class) that corrupts substring search.
        captureMode = 'textContent';
      } else if (['isolated', 'atom', 'head'].includes(format)) {
        captureMode = 'innerHTML';
      } else {
        captureMode = 'outerHTML';
      }
      let captured = await this.renderService.renderCardComponent(
        component,
        captureMode,
        format,
        this.waitForLinkedData,
      );

      if (typeof captured !== 'string') {
        return null;
      }
      await this.#ensureRenderReady(routeInfo);
      return this.processCapturedMarkup(captured, {
        isPlainText: format === 'markdown',
      });
    },
  );

  private renderAncestors = enqueueTask(
    async (
      url: string,
      format: 'embedded' | 'fitted',
      types: string[],
      renderOptions?: RenderRouteOptions,
    ) => {
      // BaseDef is part of the searchable `types` chain (so `{ type: baseRef }`
      // spans cards and files) but it is abstract — a card coerced to BaseDef
      // has no meaningful fitted/embedded template, so rendering that level is
      // pure index bloat. Skip it; the ancestor renderings cover the concrete
      // card types through CardDef.
      let baseDefKeys = new Set(
        internalKeysFor(baseRef, undefined, this.network.virtualNetwork),
      );
      let ancestors: Record<string, string> = {};
      for (let i = 0; i < types.length; i++) {
        if (baseDefKeys.has(types[i])) {
          continue;
        }
        let res = await this.renderHTML.perform(url, format, i, renderOptions);
        ancestors[types[i]] = res as string;
      }
      return ancestors;
    },
  );

  async #primeCardType(url: string, context: CardRenderContext) {
    try {
      let response = await this.network.authedFetch(url, {
        method: 'GET',
        headers: {
          Accept: SupportedMimeType.CardSource,
        },
      });
      if (!response.ok) {
        return;
      }
      let doc = (await response.json()) as
        | LooseSingleCardDocument
        | CardErrorsJSONAPI;
      if ('errors' in doc) {
        return;
      }
      let cardType = await deriveCardTypeFromDoc(
        doc,
        url,
        this.loaderService.loader,
      );
      this.#cardTypeTracker.set(context, cardType);
    } catch (_error) {
      // ignore
    }
  }

  private waitForLinkedData = async () => {
    await Promise.resolve(); // ensure lazy link fetches enqueue
    await this.store.loaded();
  };

  private renderMeta = enqueueTask(
    async (url: string, renderOptions?: RenderRouteOptions) => {
      let routeInfo = await this.router.recognizeAndLoad(
        `${this.#renderBasePath(url, renderOptions)}/meta`,
      );
      if (this.localIndexer.renderError) {
        throw new Error(this.localIndexer.renderError);
      }
      await this.#ensureRenderReady(routeInfo);
      return routeInfo.attributes as PrerenderMeta;
    },
  );

  private renderIcon = enqueueTask(
    async (url: string, renderOptions?: RenderRouteOptions) => {
      let routeInfo = await this.router.recognizeAndLoad(
        `${this.#renderBasePath(url, renderOptions)}/icon`,
      );
      if (this.localIndexer.renderError) {
        throw new Error(this.localIndexer.renderError);
      }
      let component = routeInfo.attributes.Component;
      let captured = await this.renderService.renderCardComponent(
        component,
        'outerHTML',
        'isolated',
        this.waitForLinkedData,
      );
      if (typeof captured !== 'string') {
        return null;
      }
      await this.#ensureRenderReady(routeInfo);
      return this.processCapturedMarkup(captured);
    },
  );

  // this does the work that normally the render controller is doing. we do this
  // because we are using RouterService.recognizeAndLoad() which doesn't actually do a
  // full transition, it just runs the model hook. so we need to emulate scheduling
  // the ready deferred after the component is rendered.
  #ensureRenderReady(
    routeInfo: RouteInfo | RouteInfoWithAttributes,
  ): Promise<void> {
    let current: RouteInfo | RouteInfoWithAttributes | null = routeInfo;
    while (current) {
      if (current.name === 'render' && 'attributes' in current) {
        let readyPromise = (current as RouteInfoWithAttributes).attributes
          ?.readyPromise;
        if (readyPromise && typeof readyPromise.then === 'function') {
          return readyPromise;
        }
        break;
      }
      current = current.parent as RouteInfo | RouteInfoWithAttributes | null;
    }
    return Promise.resolve();
  }

  #consumeClearCacheForRender(requestedClear = false): boolean {
    if (requestedClear) {
      this.#shouldClearCacheForNextRender = true;
    }
    if (!this.#shouldClearCacheForNextRender) {
      return false;
    }
    this.#shouldClearCacheForNextRender = false;
    return true;
  }

  private processCapturedMarkup(
    markup: string,
    opts?: { isPlainText?: boolean },
  ): string {
    // Plain-text captures (e.g. markdown-format) don't need HTML cleanup —
    // the Ember-id/empty-data-attr cleanup only makes sense for HTML.
    let cleaned = opts?.isPlainText ? markup : cleanCapturedHTML(markup);
    let errorPayload = extractPrerenderError(cleaned);
    if (errorPayload) {
      if (this.localIndexer.prerenderStatus === 'loading') {
        this.localIndexer.prerenderStatus = 'unusable';
      }
      this.localIndexer.renderError = errorPayload;
      throw new Error(errorPayload);
    }
    return cleaned;
  }
}

async function withRenderContext<T>(cb: () => Promise<T>): Promise<T> {
  let hadContext = Boolean((globalThis as any).__boxelRenderContext);
  let restoreTimers: (() => void) | undefined;
  if (!hadContext) {
    (globalThis as any).__boxelRenderContext = true;
    if (!isTesting()) {
      restoreTimers = enableRenderTimerStub();
    }
  }
  try {
    return await cb();
  } finally {
    if (!hadContext) {
      delete (globalThis as any).__boxelRenderContext;
      restoreTimers?.();
    }
  }
}

function omitOneTimeOptions(options: RenderRouteOptions): RenderRouteOptions {
  if (options.clearCache) {
    let { clearCache: _clearCache, ...rest } = options;
    return rest as RenderRouteOptions;
  }
  return options;
}

function extractPrerenderError(markup: string): string | undefined {
  if (!markup.includes('data-prerender-error')) {
    return undefined;
  }
  let start = markup.indexOf('{');
  let end = markup.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return markup.slice(start, end + 1).trim();
  }
  return undefined;
}
