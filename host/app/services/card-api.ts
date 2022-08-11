import Service, { service } from '@ember/service';
import { task, timeout } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import LocalRealm from './local-realm';
import { baseRealm } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';
export type { RenderedCard } from 'https://cardstack.com/base/render-card';

export type API = typeof import('https://cardstack.com/base/card-api');
type RenderCardResource =
  typeof import('https://cardstack.com/base/render-card');

export default class CardAPI extends Service {
  #api: API | undefined;
  #renderCard: RenderCardResource | undefined;
  @service declare localRealm: LocalRealm;

  constructor(properties: object) {
    super(properties);
    taskFor(this.load).perform();
  }

  get api() {
    if (!this.#api) {
      throw new Error(
        `bug: card API has not loaded yet--make sure to await this.loaded before using the api`
      );
    }
    return this.#api;
  }

  get render() {
    if (!this.#renderCard) {
      throw new Error(
        `bug: card API has not loaded yet--make sure to await this.loaded before using the api`
      );
    }
    return this.#renderCard.render;
  }

  get loaded(): Promise<void> {
    // TODO probably there is a more elegant way to express this in EC
    return new Promise(async (res) => {
      while (taskFor(this.load).isRunning) {
        await timeout(10);
      }
      res();
    });
  }

  @task private async load(): Promise<void> {
    this.#api = await Loader.import<API>(`${baseRealm.url}card-api`);
    this.#renderCard = await Loader.import<RenderCardResource>(
      `${baseRealm.url}render-card`
    );
  }
}
