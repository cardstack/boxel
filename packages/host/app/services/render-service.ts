import { getOwner } from '@ember/application';
import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';

//@ts-ignore no types are available
import createDocument from '@simple-dom/document';

import Parser from '@simple-dom/parser';
import Serializer from '@simple-dom/serializer';
import voidMap from '@simple-dom/void-map';

import { tokenize } from 'simple-html-tokenizer';

import type { RealmPaths } from '@cardstack/runtime-common';
import {
  logger,
  baseRealm,
  loadDocument,
  type CodeRef,
  type SingleCardDocument,
} from '@cardstack/runtime-common';
import type { Deferred } from '@cardstack/runtime-common/deferred';
import { isCardError, CardError } from '@cardstack/runtime-common/error';
import type { NotLoaded } from '@cardstack/runtime-common/not-loaded';
import { isNotLoadedError } from '@cardstack/runtime-common/not-loaded';

import config from '@cardstack/host/config/environment';

import type {
  BaseDef,
  CardDef,
  Format,
  CardStore,
  BoxComponent,
} from 'https://cardstack.com/base/card-api';

import type * as CardAPI from 'https://cardstack.com/base/card-api';

import { render } from '../lib/isolated-render';

import type CardService from './card-service';
import type LoaderService from './loader-service';
import type { ComponentLike } from '@glint/template';
import type { SimpleDocument, SimpleElement } from '@simple-dom/interface';
import type { Tokenizer } from '@simple-dom/parser';

const log = logger('renderer');

const ELEMENT_NODE_TYPE = 1;
const { environment } = config;

type NotLoadedWithDependency = NotLoaded & {
  dependencyFieldName?: string;
  dependencyInstance?: BaseDef;
};
export class CardStoreWithErrors implements CardStore {
  #cards = new Map<string, CardDef>();
  #fetch: typeof globalThis.fetch;
  #inFlight: Promise<unknown>[] = [];
  #docsInFlight: Map<string, Promise<SingleCardDocument | CardError>> =
    new Map();

  constructor(fetch: typeof globalThis.fetch) {
    this.#fetch = fetch;
  }

  get(id: string): CardDef | undefined {
    id = id.replace(/\.json$/, '');
    return this.#cards.get(id);
  }
  set(id: string, instance: CardDef): void {
    id = id.replace(/\.json$/, '');
    this.#cards.set(id, instance);
  }
  setNonTracked(id: string, instance: CardDef) {
    id = id.replace(/\.json$/, '');
    return this.#cards.set(id, instance);
  }
  makeTracked(_id: string) {}

  readonly errors = new Set<string>();

  async loadDocument(url: string) {
    let promise = this.#docsInFlight.get(url);
    if (promise) {
      return await promise;
    }
    try {
      promise = loadDocument(this.#fetch, url);
      this.#docsInFlight.set(url, promise);
      return await promise;
    } finally {
      this.#docsInFlight.delete(url);
    }
  }
  trackLoad(load: Promise<unknown>) {
    this.#inFlight.push(load);
  }
  async loaded() {
    await Promise.allSettled(this.#inFlight);
  }
}

export interface RenderCardParams {
  card: CardDef;
  visit: (url: URL, store: CardStoreWithErrors | undefined) => Promise<void>;
  format?: Format;
  store: CardStoreWithErrors;
  realmPath: RealmPaths;
  componentCodeRef?: CodeRef;
}
export type RenderCard = (params: RenderCardParams) => Promise<string>;
export type Render = (component: ComponentLike) => string;

// this means that we'll attempt up to 50 tries to load all the linked fields
// consumed by a card. Any unloaded linked field in this card or an embedded
// card exhausts a single attempt
const maxRenderThreshold = 50;
export default class RenderService extends Service {
  // @ts-expect-error the types for this invocation of @service() don't work
  @service('-document') document: SimpleDocument;
  @service declare loaderService: LoaderService;
  @service declare cardService: CardService;
  indexRunDeferred: Deferred<void> | undefined;
  renderError: Error | undefined;
  owner: Owner = getOwner(this)!;

  renderCard = async (params: RenderCardParams): Promise<string> => {
    let {
      card,
      visit,
      format = 'embedded',
      store,
      realmPath,
      componentCodeRef,
    } = params;
    const cardApi = await this.loaderService.loader.import<typeof CardAPI>(
      `${baseRealm.url}card-api`,
    );
    let component = cardApi.getComponent(card, undefined, {
      componentCodeRef,
    });

    let element = getIsolatedRenderElement(this.document);
    let notLoaded: NotLoaded | undefined;
    let tries = 0;
    do {
      notLoaded = undefined;
      try {
        log.debug(`rendering ${card.id} for indexing attempt #${tries}`);
        render(component, element, this.owner, format);
      } catch (err: any) {
        notLoaded = err.additionalErrors?.find((e: any) =>
          isNotLoadedError(e),
        ) as NotLoaded | undefined;
        if (isCardError(err) && notLoaded) {
          let errorInstance = notLoaded?.instance;
          if (!errorInstance) {
            throw new Error(`bug: could not determine NotLoaded card instance`);
          }
          let fieldName = notLoaded?.fieldName;
          if (!fieldName) {
            throw new Error(`bug: could not determine NotLoaded field`);
          }
          await this.resolveField({
            card: errorInstance,
            fieldName,
            notLoaded: notLoaded as NotLoadedWithDependency,
            store,
            visit,
            realmPath,
          });
        } else {
          throw err;
        }
      }
    } while (notLoaded && tries++ <= maxRenderThreshold);

    // This guards against bugs that may trigger render cycles
    if (tries > maxRenderThreshold) {
      let error = new CardError(
        `detected a cycle trying to render card ${card.constructor.name} (id: ${card.id})`,
      );
      error.additionalErrors = [notLoaded!];
      throw error;
    }

    let serializer = new Serializer(voidMap);
    let html = serializer.serialize(element);
    return parseCardHtml(html);
  };

  renderCardComponent(
    component: BoxComponent,
    capture: 'innerHTML' | 'outerHTML' = 'outerHTML',
    format: Format = 'isolated',
  ): string {
    let element = getIsolatedRenderElement(this.document);
    render(component, element, this.owner, format);
    let serializer = new Serializer(voidMap);
    let html = serializer.serialize(element);
    return parseCardHtml(html, capture);
  }

  render = (component: ComponentLike): string => {
    let element = getIsolatedRenderElement(this.document);
    render(component, element, this.owner);

    let serializer = new Serializer(voidMap);
    let html = serializer.serialize(element);
    return parseCardHtml(html);
  };

  // TODO delete me
  private async resolveField(
    params: Omit<RenderCardParams, 'format'> & {
      fieldName: string;
      notLoaded: NotLoadedWithDependency;
    },
  ): Promise<void> {
    let { card, visit, store, realmPath, fieldName, notLoaded } = params;
    let api = await this.loaderService.loader.import<typeof CardAPI>(
      `${baseRealm.url}card-api`,
    );
    try {
      let dependencyInstance =
        (notLoaded.dependencyInstance as BaseDef | undefined) ?? undefined;
      let fieldToResolve = fieldName;
      let instanceToResolve: BaseDef = card;
      // Only follow dependency-specific resolution when the dependency belongs
      // to the card that is currently rendering. Otherwise we fall back to the
      // legacy behaviour so that cyclic links keep using the async lazy loader.
      if (dependencyInstance === card) {
        instanceToResolve = dependencyInstance;
        if (notLoaded.dependencyFieldName) {
          fieldToResolve = notLoaded.dependencyFieldName as typeof fieldName;
        }
      }
      await api.getIfReady(instanceToResolve as any, fieldToResolve as any);
    } catch (error: any) {
      let errors = Array.isArray(error) ? error : [error];
      for (let err of errors) {
        let unresolved = err.additionalErrors?.find((e: any) =>
          isNotLoadedError(e),
        ) as NotLoadedWithDependency | undefined;
        if (isCardError(err) && err.status !== 500 && unresolved) {
          let links =
            typeof unresolved.reference === 'string'
              ? [unresolved.reference]
              : unresolved.reference;
          for (let link of links) {
            if (store.errors.has(link)) {
              throw err; // the linked card was already found to be in an error state
            }
            let linkURL = new URL(`${link}.json`);
            if (realmPath.inRealm(linkURL)) {
              await visit(linkURL, store);
            } else {
              let doc = await store.loadDocument(linkURL.href);
              if (isCardError(doc)) {
                store.errors.add(link);
                throw doc;
              }
            }
          }
        } else {
          throw err;
        }
      }
    }
  }
}

export function parseCardHtml(
  html: string,
  capture: 'innerHTML' | 'outerHTML' = 'outerHTML',
): string {
  let document = createDocument();
  let parser = new Parser(tokenize as Tokenizer, document, voidMap);
  let fragment = parser.parse(html).firstChild;
  if (!fragment) {
    throw new Error(`no HTML to parse`);
  }
  let serializer = new Serializer(voidMap);

  let parts: string[] = [];
  for (let node = fragment.firstChild; node; node = node.nextSibling) {
    if (capture === 'innerHTML') {
      if (node.nodeType !== ELEMENT_NODE_TYPE) {
        continue;
      }
      let element = node as SimpleElement;
      for (let child = element.firstChild; child; child = child.nextSibling) {
        parts.push(serializer.serialize(child));
      }
      return parts.join('').trim();
    } else {
      parts.push(serializer.serialize(node));
    }
  }
  if (capture === 'outerHTML') {
    return parts.join('').trim();
  }
  throw new Error(`unable to determine HTML for card. found HTML:\n${html}`);
}

function getChildElementById(
  id: string,
  parent: SimpleElement,
): SimpleElement | undefined {
  let child = parent.firstChild;
  while (
    child &&
    (child.nodeType !== ELEMENT_NODE_TYPE || child.getAttribute('id') !== id)
  ) {
    child = child.nextSibling;
  }
  if (child == null) {
    return undefined;
  }
  return child;
}

function getElementFromIdPath(
  path: string[],
  parent: SimpleElement,
): SimpleElement | undefined {
  if (path.length === 0) {
    throw new Error(`cannot get element from id path with empty path array`);
  }
  let child = getChildElementById(path.shift()!, parent);
  if (!child) {
    return undefined;
  }
  if (path.length === 0) {
    return child;
  }
  return getElementFromIdPath(path, child);
}

export function getIsolatedRenderElement(
  document: SimpleDocument,
): SimpleElement {
  let element: SimpleElement | undefined;
  if (environment === 'test') {
    element = getElementFromIdPath(
      [
        'qunit-fixture',
        'ember-testing-container',
        'ember-testing',
        'isolated-render',
      ],
      document.body,
    );
    if (!element) {
      let parent = getElementFromIdPath(
        ['qunit-fixture', 'ember-testing-container', 'ember-testing'],
        document.body,
      );
      if (!parent) {
        throw new Error(`bug: cannot find ember testing container`);
      }
      element = document.createElement('div');
      element.setAttribute('id', 'isolated-render');
      parent.appendChild(element);
    }
  } else {
    element = getElementFromIdPath(['isolated-render'], document.body);
    if (!element) {
      element = document.createElement('div');
      element.setAttribute('id', 'isolated-render');
      document.body.appendChild(element);
    }
  }
  return element;
}
