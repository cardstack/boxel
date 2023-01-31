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
import { baseRealm, RealmPaths } from '@cardstack/runtime-common';
import type CardService from './card-service';
import type LoaderService from './loader-service';
import type { SimpleDocument, SimpleElement } from '@simple-dom/interface';
import type Owner from '@ember/owner';
import {
  type IdentityContext as IdentityContextType,
  type Card,
  type Format,
} from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

const ELEMENT_NODE_TYPE = 1;
const { environment } = config;

interface RenderCardParams {
  card: Card;
  visit: (
    url: URL,
    identityContext: IdentityContextType | undefined
  ) => Promise<void>;
  format?: Format;
  identityContext: IdentityContextType;
  realmPath: RealmPaths;
}
export type RenderCard = (params: RenderCardParams) => Promise<string>;

export default class RenderService extends Service {
  // @ts-expect-error the types for this invocation of @service() don't work
  @service('-document') document: SimpleDocument;
  @service declare loaderService: LoaderService;
  @service declare cardService: CardService;
  indexRunDeferred: Deferred<void> | undefined;
  renderError: Error | undefined;
  owner: Owner = getOwner(this)!;

  async renderCard(params: RenderCardParams): Promise<string> {
    let {
      card,
      visit,
      format = 'embedded',
      identityContext,
      realmPath,
    } = params;
    let component = card.constructor.getComponent(card, format, {
      disableShadowDOM: true,
    });

    let element = getIsolatedRenderElement(this.document);
    // this loop looks really similar to the API's recompute's
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
          card = notReady?.model ?? card; // a nested card may be the card that is not ready
          let fieldName = notReady?.fieldName ?? notLoaded?.fieldName;
          if (!fieldName) {
            throw new Error(`bug: should never get here`);
          }
          await this.resolveField({
            card,
            fieldName,
            identityContext,
            visit,
            realmPath,
          });
        } else {
          throw err;
        }
      }

      // TODO make a test that shows we throw for fields that can't be loaded (broken links)
    } while (notLoaded || notReady);

    let serializer = new Serializer(voidMap);
    let html = serializer.serialize(element);
    return parseCardHtml(html);
  }

  private async resolveField(
    params: Omit<RenderCardParams, 'format'> & { fieldName: string }
  ): Promise<void> {
    let { card, visit, identityContext, realmPath, fieldName } = params;
    let api = await this.loaderService.loader.import<typeof CardAPI>(
      `${baseRealm.url}card-api`
    );
    let value: any;
    try {
      value = await api.getIfReady(card, fieldName as keyof Card, undefined, {
        loadFields: true,
      });
    } catch (err: any) {
      let notLoaded = err.additionalErrors?.find((e: any) =>
        isNotLoadedError(e)
      ) as NotLoaded | undefined;
      if (isCardError(err) && notLoaded) {
        let linkURL = new URL(`${notLoaded.reference}.json`);
        if (realmPath.inRealm(linkURL)) {
          await visit(linkURL, identityContext);
        } else {
          // in this case the instance we are linked to is a missing instance
          // in an external realm.
          throw err;
        }
      } else {
        throw err;
      }
    }

    if (Array.isArray(value)) {
      for (let item of value) {
        if (item && api.isCard(item)) {
          await this.renderCard({
            card: item,
            visit,
            realmPath,
            identityContext,
          });
        }
      }
    }
    if (api.isCard(value)) {
      await this.renderCard({ card: value, visit, realmPath, identityContext });
    }
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
