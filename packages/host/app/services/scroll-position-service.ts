import type Owner from '@ember/owner';
import Service, { service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import window from 'ember-window-mock';
import { TrackedMap } from 'tracked-built-ins';

import type ResetService from './reset';

export default class ScrollPositionService extends Service {
  @service private declare reset: ResetService;
  @tracked private declare keyToScrollPosition: TrackedMap<
    string,
    [string, number]
  >;

  constructor(owner: Owner) {
    super(owner);
    this.resetState();
    this.reset.register(this);
    this.extractFromStorage();
  }

  resetState() {
    this.keyToScrollPosition = new TrackedMap();
  }

  containerHasScrollPosition(container: string) {
    return this.keyToScrollPosition.has(container);
  }

  keyHasScrollPosition(container: string, key: string) {
    return (
      this.keyToScrollPosition.has(container) &&
      this.keyToScrollPosition.get(container)?.[0] === key
    );
  }

  getScrollPosition(container: string, key: string) {
    let entry = this.keyToScrollPosition.get(container);

    if (!entry) {
      return undefined;
    }

    if (entry[0] !== key) {
      return undefined;
    }

    return entry[1];
  }

  setScrollPosition(container: string, key: string, position: number) {
    this.keyToScrollPosition.set(container, [key, position]);
    this.persist();
  }

  private persist() {
    window.localStorage.setItem(
      'scroll-positions',
      JSON.stringify(Object.fromEntries(this.keyToScrollPosition)),
    );
  }

  private extractFromStorage() {
    let scrollPositionsString = window.localStorage.getItem('scroll-positions');

    if (scrollPositionsString) {
      try {
        this.keyToScrollPosition = new TrackedMap(
          Object.entries(JSON.parse(scrollPositionsString)),
        );
      } catch (e) {
        console.log('Error restoring scroll positions', e);
      }
    }
  }
}
