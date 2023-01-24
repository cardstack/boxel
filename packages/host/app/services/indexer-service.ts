import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { Deferred } from '@cardstack/runtime-common/deferred';
import Serializer from '@simple-dom/serializer';
import voidMap from '@simple-dom/void-map';
import { getIsolatedRenderElement, afterRender } from '../components/render';
import type CardService from './card-service';
import type LoaderService from './loader-service';
import type { Card } from 'https://cardstack.com/base/card-api';
import type { SimpleDocument } from '@simple-dom/interface';

// TODO rename to render-service.ts
export default class IndexerService extends Service {
  // @ts-expect-error the types for this invocation of @service() don't work
  @service('-document') document: SimpleDocument;
  @service declare loaderService: LoaderService;
  @service declare cardService: CardService;
  @tracked card: Card | undefined;
  indexRunDeferred: Deferred<void> | undefined;
  renderError: Error | undefined;

  // this seems to want to live in a service and not in the component that
  // renders this card. within the service we are able to see the resulting
  // card's serialized HTML. However, when this logic lives in the component we
  // can only ever see the previous rendered card's html
  async renderCard(
    url: URL,
    staticResponses: Map<string, string>
  ): Promise<string> {
    this.renderError = undefined;
    this.loaderService.setStaticResponses(staticResponses);
    let card = await this.cardService.loadModel(url, { absoluteURL: true });
    if (!card) {
      throw new Error(`card ${url.href} not found`);
    } else {
      this.card = card;
      // it takes 2 renders for to establish the isolated renderer (after that
      // point the 2nd render is superfluous)
      await afterRender();
      await afterRender();
      if (this.renderError) {
        // TODO handle this
        debugger;
      } else {
        let serializer = new Serializer(voidMap);
        let html = serializer.serialize(
          getIsolatedRenderElement(this.document)
        );
        return parseCardHtml(html);
      }
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
