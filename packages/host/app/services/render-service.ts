import Service, { service } from '@ember/service';
import { Deferred } from '@cardstack/runtime-common/deferred';
import Serializer from '@simple-dom/serializer';
import voidMap from '@simple-dom/void-map';
import config from '@cardstack/host/config/environment';
import { getOwner } from '@ember/application';
import { render } from '../lib/isolated-render';
import type CardService from './card-service';
import type LoaderService from './loader-service';
import type { SimpleDocument, SimpleElement } from '@simple-dom/interface';
import type Owner from '@ember/owner';

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

  async renderCard(
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
