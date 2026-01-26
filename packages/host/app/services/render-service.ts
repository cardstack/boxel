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
  loadCardDocument,
  loadFileMetaDocument,
  type CardError,
  type CodeRef,
  type SingleCardDocument,
  type SingleFileMetaDocument,
} from '@cardstack/runtime-common';

import config from '@cardstack/host/config/environment';

import type {
  CardDef,
  Format,
  CardStore,
  BoxComponent,
} from 'https://cardstack.com/base/card-api';
import type { FileDef } from 'https://cardstack.com/base/file-api';

import { render } from '../lib/isolated-render';

import type CardService from './card-service';
import type LoaderService from './loader-service';
import type { ComponentLike } from '@glint/template';
import type { SimpleDocument, SimpleElement } from '@simple-dom/interface';
import type { Tokenizer } from '@simple-dom/parser';

const ELEMENT_NODE_TYPE = 1;
const { environment } = config;

export class CardStoreWithErrors implements CardStore {
  #cards = new Map<string, CardDef>();
  #fileMetaInstances = new Map<string, FileDef>();
  #fetch: typeof globalThis.fetch;
  #inFlight: Promise<unknown>[] = [];
  #cardDocsInFlight: Map<string, Promise<SingleCardDocument | CardError>> =
    new Map();
  #fileMetaDocsInFlight: Map<
    string,
    Promise<SingleFileMetaDocument | CardError>
  > = new Map();

  constructor(fetch: typeof globalThis.fetch) {
    this.#fetch = fetch;
  }

  getCard(id: string): CardDef | undefined {
    id = id.replace(/\.json$/, '');
    return this.#cards.get(id);
  }
  getFileMeta(id: string): FileDef | undefined {
    id = id.replace(/\.json$/, '');
    return this.#fileMetaInstances.get(id);
  }
  setCard(id: string, instance: CardDef): void {
    id = id.replace(/\.json$/, '');
    this.#cards.set(id, instance);
  }
  setFileMeta(id: string, instance: FileDef): void {
    id = id.replace(/\.json$/, '');
    this.#fileMetaInstances.set(id, instance);
  }
  setCardNonTracked(id: string, instance: CardDef) {
    id = id.replace(/\.json$/, '');
    return this.#cards.set(id, instance);
  }
  makeTracked(_id: string) {}

  readonly errors = new Set<string>();

  async loadCardDocument(url: string) {
    let promise = this.#cardDocsInFlight.get(url);
    if (promise) {
      return await promise;
    }
    try {
      promise = loadCardDocument(this.#fetch, url);
      this.#cardDocsInFlight.set(url, promise);
      return await promise;
    } finally {
      this.#cardDocsInFlight.delete(url);
    }
  }

  async loadFileMetaDocument(url: string) {
    let promise = this.#fileMetaDocsInFlight.get(url);
    if (promise) {
      return await promise;
    }
    try {
      promise = loadFileMetaDocument(this.#fetch, url);
      this.#fileMetaDocsInFlight.set(url, promise);
      return await promise;
    } finally {
      this.#fileMetaDocsInFlight.delete(url);
    }
  }

  trackLoad(load: Promise<unknown>) {
    this.#inFlight.push(load);
  }
  async loaded() {
    await Promise.allSettled(this.#inFlight);
  }
  getSearchResource<T extends CardDef = CardDef>(
    _parent: object,
    _getQuery: () => any,
    _getRealms?: () => string[] | undefined,
    _opts?: any,
  ) {
    return {
      instances: [] as T[],
      instancesByRealm: [],
      isLoading: false,
      meta: { page: { total: 0 } },
      errors: undefined,
    } as any;
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

export default class RenderService extends Service {
  // @ts-expect-error the types for this invocation of @service() don't work
  @service('-document') document: SimpleDocument;
  @service declare loaderService: LoaderService;
  @service declare cardService: CardService;
  renderError: Error | undefined;
  owner: Owner = getOwner(this)!;

  async renderCardComponent(
    component: BoxComponent,
    capture: 'innerHTML' | 'outerHTML' = 'outerHTML',
    format: Format = 'isolated',
    waitForAsync?: () => Promise<void>,
  ): Promise<string> {
    let element = getIsolatedRenderElement(this.document);
    try {
      render(component, element, this.owner, format);
      await waitForAsync?.();
      // re-render after we have waited for the links to finish loading
      render(component, element, this.owner, format);
      let serializer = new Serializer(voidMap);
      let html = serializer.serialize(element);
      return parseCardHtml(html, capture);
    } finally {
      clearIsolatedRenderElement(element);
    }
  }

  render = (component: ComponentLike): string => {
    let element = getIsolatedRenderElement(this.document);
    try {
      render(component, element, this.owner);

      let serializer = new Serializer(voidMap);
      let html = serializer.serialize(element);
      return parseCardHtml(html);
    } finally {
      clearIsolatedRenderElement(element);
    }
  };
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

function clearIsolatedRenderElement(element: SimpleElement) {
  let child = element.firstChild;
  while (child) {
    let next = child.nextSibling;
    element.removeChild(child);
    child = next;
  }
}
