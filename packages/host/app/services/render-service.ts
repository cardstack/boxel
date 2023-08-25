import Service, { service } from '@ember/service';
import { Deferred } from '@cardstack/runtime-common/deferred';
import { isCardError, CardError } from '@cardstack/runtime-common/error';
import { isNotReadyError, NotReady } from '@cardstack/runtime-common/not-ready';
import {
  isNotLoadedError,
  NotLoaded,
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
  type CardDef,
  type Format,
} from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

const ELEMENT_NODE_TYPE = 1;
const { environment } = config;

interface RenderCardParams {
  card: CardDef;
  visit: (
    url: URL,
    identityContext: IdentityContextType | undefined,
  ) => Promise<void>;
  format?: Format;
  identityContext: IdentityContextType;
  realmPath: RealmPaths;
}
export type RenderCard = (params: RenderCardParams) => Promise<string>;

const maxRenderThreshold = 10000;
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
    let component = card.constructor.getComponent(card, format);

    let element = getIsolatedRenderElement(this.document);
    // TODO: consider consolidating the NotReady and NotLoaded objects into a single object
    let notReady: NotReady | undefined;
    let notLoaded: NotLoaded | undefined;
    let tries = 0;
    do {
      notReady = undefined;
      notLoaded = undefined;
      try {
        render(component, element, this.owner);
      } catch (err: any) {
        notReady = err.additionalErrors?.find((e: any) =>
          isNotReadyError(e),
        ) as NotReady | undefined;
        notLoaded = err.additionalErrors?.find((e: any) =>
          isNotLoadedError(e),
        ) as NotLoaded | undefined;
        if (isCardError(err) && (notReady || notLoaded)) {
          let errorInstance = notReady?.instance ?? notLoaded?.instance;
          if (!errorInstance) {
            throw new Error(
              `bug: could not determine NotLoaded/NotReady card instance`,
            );
          }
          let fieldName = notReady?.fieldName ?? notLoaded?.fieldName;
          if (!fieldName) {
            throw new Error(
              `bug: could not determine NotLoaded/NotReady field`,
            );
          }
          await this.resolveField({
            card: errorInstance,
            fieldName,
            identityContext,
            visit,
            realmPath,
          });
        } else {
          throw err;
        }
      }
    } while ((notLoaded || notReady) && tries++ <= maxRenderThreshold);

    // This guards against bugs that may trigger render cycles
    if (tries > maxRenderThreshold) {
      let error = new CardError(
        `detected a cycle trying to render card ${card.constructor.name} (id: ${card.id})`,
      );
      error.additionalErrors = [(notLoaded ?? notReady)!];
      throw error;
    }

    let serializer = new Serializer(voidMap);
    let html = serializer.serialize(element);
    return parseCardHtml(html);
  }

  private async resolveField(
    params: Omit<RenderCardParams, 'format'> & { fieldName: string },
  ): Promise<void> {
    let { card, visit, identityContext, realmPath, fieldName } = params;
    let api = await this.loaderService.loader.import<typeof CardAPI>(
      `${baseRealm.url}card-api`,
    );
    try {
      await api.getIfReady(card, fieldName as keyof CardDef, undefined, {
        loadFields: true,
      });
    } catch (error: any) {
      let errors = Array.isArray(error) ? error : [error];
      for (let err of errors) {
        let notLoaded = err.additionalErrors?.find((e: any) =>
          isNotLoadedError(e),
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
    }
  }
}

function parseCardHtml(html: string): string {
  let matches = html.matchAll(
    /<div id="isolated-render"[^>]*>[\n\s]*(?<html>[\W\w\n\s]*)[\s\n]*<\/div>/gm,
  );
  for (let match of matches) {
    let { html } = match.groups as { html: string };
    return html.trim();
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
