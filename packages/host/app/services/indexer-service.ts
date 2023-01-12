import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { Deferred } from '@cardstack/runtime-common/deferred';
import Serializer from '@simple-dom/serializer';
import voidMap from '@simple-dom/void-map';
import { schedule } from '@ember/runloop';
import type CardService from './card-service';
import type LoaderService from './loader-service';
import type { Card } from 'https://cardstack.com/base/card-api';
import type { SimpleDocument } from '@simple-dom/interface';

async function afterRender() {
  return new Promise<void>((res) => {
    schedule('afterRender', function () {
      res();
    });
  });
}

export default class IndexerService extends Service {
  // @ts-expect-error the types for this invocation of @service() don't work
  @service('-document') document: SimpleDocument;
  @service declare loaderService: LoaderService;
  @service declare cardService: CardService;
  @tracked card: Card | undefined;
  indexRunDeferred: Deferred<void> | undefined;

  // this seems to want to live in a service and not in the component that
  // renders this card. within the service we are able to see the resulting
  // card's serialized HTML. However, when this logic lives in the component we
  // can only ever see the previous rendered card's html
  async renderCard(
    url: URL,
    staticResponses: Map<string, string>
  ): Promise<string> {
    this.loaderService.setStaticResponses(staticResponses);
    let card = await this.cardService.loadModel(url, { absoluteURL: true });
    if (!card) {
      throw new Error(`card ${url.href} not found`);
    } else {
      this.card = card;
      await afterRender();
      // the latest render will be available 1 micro task after the render
      await Promise.resolve();
      let serializer = new Serializer(voidMap);
      // TODO use simple DOM to get this component's element instead of using whole doc
      let html = serializer.serialize(this.document);
      return parseCardHtml(html);
    }
  }
}

function parseCardHtml(html: string): string {
  let matches = html.matchAll(
    /<!--Server Side Rendered Card HTML START-->[\n\s]*(?<html>[\W\w\n\s]*?)[\s\n]*<!--Server Side Rendered Card HTML END-->/gm
  );
  for (let match of matches) {
    let { html } = match.groups as { html: string };
    return html;
  }
  throw new Error(`unable to determine HTML for card. found HTML:\n${html}`);
}
