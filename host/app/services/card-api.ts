import Service from '@ember/service';
import { task } from 'ember-concurrency';
import { taskFor } from 'ember-concurrency-ts';
import { baseRealm } from '@cardstack/runtime-common';
import config from 'runtime-spike/config/environment';

export type API = typeof import('https://cardstack.com/base/card-api');
export type StringModule = typeof import('https://cardstack.com/base/string');
export type IntegerModule = typeof import('https://cardstack.com/base/integer');
export type DateModule = typeof import('https://cardstack.com/base/date');
export type DatetimeModule =
  typeof import('https://cardstack.com/base/datetime');
export type PickModule = typeof import('https://cardstack.com/base/pick');

export default class CardAPI extends Service {
  #api: API | undefined;
  #string: StringModule | undefined;
  #integer: IntegerModule | undefined;
  #date: DateModule | undefined;
  #datetime: DatetimeModule | undefined;
  #pick: PickModule | undefined;

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

  get testModules() {
    if (
      !this.#string ||
      !this.#integer ||
      !this.#date ||
      !this.#datetime ||
      !this.#pick
    ) {
      throw new Error(
        `bug: card API has not loaded yet--make sure to await this.loaded before using the api`
      );
    }
    return {
      string: this.#string,
      integer: this.#integer,
      date: this.#date,
      datetime: this.#datetime,
      pick: this.#pick,
    };
  }

  get loaded(): Promise<void> {
    return (this.load as any).last.isRunning;
  }

  @task private async load(): Promise<void> {
    if (config.environment === 'test') {
      this.#api = await import(
        /* webpackIgnore: true */ 'http://localhost:4201/base/card-api' + ''
      );
      this.#string = await import(
        /* webpackIgnore: true */ 'http://localhost:4201/base/string' + ''
      );
      this.#integer = await import(
        /* webpackIgnore: true */ 'http://localhost:4201/base/integer' + ''
      );
      this.#date = await import(
        /* webpackIgnore: true */ 'http://localhost:4201/base/date' + ''
      );
      this.#datetime = await import(
        /* webpackIgnore: true */ 'http://localhost:4201/base/datetime' + ''
      );
      this.#pick = await import(
        /* webpackIgnore: true */ 'http://localhost:4201/base/pick' + ''
      );
    } else {
      this.#api = await import(
        /* webpackIgnore: true */ `${baseRealm.url}card-api`
      );
    }
  }
}
