import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { Deferred } from '@cardstack/runtime-common/deferred';
import type RouterService from '@ember/routing/router-service';
import type LoaderService from './loader-service';
import type { Card, Format } from 'https://cardstack.com/base/card-api';

export default class WorkerRenderer extends Service {
  @service declare router: RouterService;
  @service declare loaderService: LoaderService;
  @tracked card: Card | undefined;
  @tracked format: Format | undefined;
  private deferred: Deferred<string> | undefined;

  async visit(
    path: string,
    staticResponses: Map<string, string>,
    send: (html: string) => void
  ) {
    this.loaderService.setStaticResponses(staticResponses);
    let { attributes } = await this.router.recognizeAndLoad(path);
    let { card, format } = attributes as { card: Card; format: Format };
    this.deferred = new Deferred();
    this.card = card;
    this.format = format;
    let html = await this.deferred.promise;

    // let html = `
    // <!--Server Side Rendered Card START-->
    // <h1>Hello World!</h1>
    // <!--Server Side Rendered Card END-->
    // `;
    send(html);
  }

  captureSnapshot(html: string) {
    if (!this.deferred) {
      throw new Error(`unexpected snapshot received:\n${html}`);
    }
    this.deferred.fulfill(html);
  }
}
