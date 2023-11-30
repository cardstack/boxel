import Service from '@ember/service';

import { tracked } from '@glimmer/tracking';

import window from 'ember-window-mock';
import { TrackedMap } from 'tracked-built-ins';

export default class ScrollPositionService extends Service {
  @tracked keyToScrollPosition = new TrackedMap<string, number>();

  constructor(properties: object) {
    super(properties);
    this.extractFromStorage();
  }

  keyHasScrollPosition(key: string) {
    return this.keyToScrollPosition.has(key);
  }

  get(key: string) {
    return this.keyToScrollPosition.get(key);
  }

  clearKey(key: string) {
    this.keyToScrollPosition.remove(key);
    this.persist();
  }

  setKeyScrollPosition(key: string, position: number) {
    this.keyToScrollPosition.set(key, position);
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
