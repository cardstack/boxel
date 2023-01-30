import Service, { service } from '@ember/service';
import { Deferred } from '@cardstack/runtime-common/deferred';
import { isCardError } from '@cardstack/runtime-common/error';
import {
  isNotReadyError,
  type NotReady,
} from '@cardstack/runtime-common/not-ready';
import {
  isNotLoadedError,
  type NotLoaded,
} from '@cardstack/runtime-common/not-loaded';
import Serializer from '@simple-dom/serializer';
import voidMap from '@simple-dom/void-map';
import config from '@cardstack/host/config/environment';
import { getOwner } from '@ember/application';
import { render } from '../lib/isolated-render';
import { baseRealm } from '@cardstack/runtime-common';
import type CardService from './card-service';
import type LoaderService from './loader-service';
import type { SimpleDocument, SimpleElement } from '@simple-dom/interface';
import type Owner from '@ember/owner';
import { type Card } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

const ELEMENT_NODE_TYPE = 1;
const { environment } = config;

export default class RenderService extends Service {
  // @ts-expect-error the types for this invocation of @service() don't work
  @service('-document') document: SimpleDocument;
  @service declare loaderService: LoaderService;
  @service declare cardService: CardService;
  indexRunDeferred: Deferred<void> | undefined;
  renderError: Error | undefined;
  owner: Owner = getOwner(this)!;

  // TODO this will be retired
  async _renderCard(
    url: URL,
    staticResponses: Map<string, string>
  ): Promise<string> {
    this.renderError = undefined;
    this.loaderService.setStaticResponses(staticResponses);
    let card = await this.cardService.loadModel(url, { absoluteURL: true });
    if (!card) {
      throw new Error(`card ${url.href} not found`);
    }
    let component = card.constructor.getComponent(card, 'isolated', {
      disableShadowDOM: true,
    });

    let serializer = new Serializer(voidMap);
    let element = getIsolatedRenderElement(this.document);

    render(component, element, this.owner);
    let html = serializer.serialize(element);
    return parseCardHtml(html);
  }

  // Note that we use a document instead of a resource, since the included could
  // save us some work for fields that are already loaded
  async renderCard(card: Card): Promise<string> {
    let component = card.constructor.getComponent(card, 'isolated', {
      disableShadowDOM: true,
    });

    let element = getIsolatedRenderElement(this.document);
    // TODO: this loop looks really similar to the API's recompute's
    // _loadModel(). The primary difference is that we are letting the render
    // drive the field load as opposed to the card schema
    let notReady: NotReady | undefined;
    let notLoaded: NotLoaded | undefined;
    do {
      notReady = undefined;
      notLoaded = undefined;
      try {
        render(component, element, this.owner);
      } catch (err: any) {
        notReady = err.additionalErrors?.find((e: any) =>
          isNotReadyError(e)
        ) as NotReady | undefined;
        notLoaded = err.additionalErrors?.find((e: any) =>
          isNotLoadedError(e)
        ) as NotLoaded | undefined;
        if (isCardError(err) && (notReady || notLoaded)) {
          let fieldName = (notReady?.fieldName ??
            notLoaded?.fieldName) as keyof Card;
          let api = await this.loaderService.loader.import<typeof CardAPI>(
            `${baseRealm.url}card-api`
          );
          // TODO probably need to emulate the API's recompute#_loadModel()'s
          // handling of 'value' here
          let value = await api.getIfReady(card, fieldName, undefined, {
            loadFields: true,
          });
          // TODO recurse into cards and array of cards--may need to keep track
          // of stack to break cycles, and deal with fields that cant be loaded.
          // Also identityMap handling needs to be considered.
        } else {
          throw err;
        }
      }

      // TODO make sure to break for fields that can't be loaded
    } while (notLoaded || notReady);

    let serializer = new Serializer(voidMap);
    let html = serializer.serialize(element);
    return parseCardHtml(html);
  }
}

function parseCardHtml(html: string): string {
  let matches = html.matchAll(
    /<div id="isolated-render"[^>]*>[\n\s]*(?<html>[\W\w\n\s]*)[\s\n]*<\/div>/gm
  );
  for (let match of matches) {
    let { html } = match.groups as { html: string };
    return html.trim();
  }
  throw new Error(`unable to determine HTML for card. found HTML:\n${html}`);
}

function getChildElementById(
  id: string,
  parent: SimpleElement
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
  parent: SimpleElement
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
  document: SimpleDocument
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
      document.body
    );
    if (!element) {
      let parent = getElementFromIdPath(
        ['qunit-fixture', 'ember-testing-container', 'ember-testing'],
        document.body
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
