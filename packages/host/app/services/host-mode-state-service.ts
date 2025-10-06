import RouterService from '@ember/routing/router-service';
import { scheduleOnce } from '@ember/runloop';
import Service, { service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import stringify from 'safe-stable-stringify';

interface InitializeOptions {
  primaryCardId: string | null;
  stack: string[];
  routePath: string;
}

type SerializedStack = string[];

export default class HostModeStateService extends Service {
  @service declare router: RouterService;

  @tracked private primaryCardId: string | null = null;
  @tracked private stackCardIds: string[] = [];
  private currentRoutePath: string | null = null;
  private persistenceEnabled = false;

  initialize({ primaryCardId, stack, routePath }: InitializeOptions) {
    this.persistenceEnabled = false;
    this.primaryCardId = primaryCardId
      ? primaryCardId.replace(/\.json$/, '')
      : null;
    this.stackCardIds = this.normalizeIds(stack);
    this.currentRoutePath = routePath;
    this.persistenceEnabled = true;
  }

  updateRoutePath(routePath: string) {
    this.currentRoutePath = routePath;
  }

  get hostModeCardIds() {
    if (!this.primaryCardId) {
      return [] as string[];
    }

    return [this.primaryCardId, ...this.stackCardIds];
  }

  get currentCardId() {
    return this.hostModeCardIds[0];
  }

  setPrimaryCard(cardId: string | null) {
    this.primaryCardId = cardId;
    this.schedulePersist();
  }

  setStack(cardIds: string[]) {
    this.stackCardIds = this.normalizeIds(cardIds);
    this.schedulePersist();
  }

  pushCard(cardId: string) {
    if (!cardId) {
      return;
    }
    if (cardId === this.primaryCardId || this.stackCardIds.includes(cardId)) {
      return;
    }

    this.stackCardIds = [...this.stackCardIds, cardId];
    this.schedulePersist();
  }

  closeCard(cardId: string) {
    let updatedStack = this.stackCardIds.filter((id) => id !== cardId);

    if (updatedStack.length === this.stackCardIds.length) {
      // Attempting to close primary card or card that is not stacked; ignore.
      return;
    }

    this.stackCardIds = updatedStack;
    this.schedulePersist();
  }

  deserialize(serialized: string | undefined | null): string[] {
    if (!serialized) {
      return [];
    }

    try {
      let parsed = JSON.parse(serialized) as SerializedStack;
      if (Array.isArray(parsed)) {
        return this.normalizeIds(parsed.filter((id) => typeof id === 'string'));
      }
    } catch (error) {
      // Ignore malformed data and reset stack
    }

    return [];
  }

  serialize(): string | undefined {
    if (this.stackCardIds.length === 0) {
      return undefined;
    }

    return stringify(this.stackCardIds) ?? undefined;
  }

  private normalizeIds(ids: string[]) {
    return ids
      .filter(Boolean)
      .map((id) => id.replace(/\.json$/, ''))
      .filter((id, index, arr) => arr.indexOf(id) === index);
  }

  private schedulePersist() {
    if (!this.persistenceEnabled) {
      return;
    }

    scheduleOnce('afterRender', this, this.persist);
  }

  private persist() {
    if (!this.persistenceEnabled || !this.currentRoutePath) {
      return;
    }

    let serialized = this.serialize();
    // Preserve the param if there is a stack, otherwise remove it to keep the URL clean.
    this.router.transitionTo('card', this.currentRoutePath, {
      queryParams: {
        hostModeStack: serialized,
      },
    });
  }
}

declare module '@ember/service' {
  interface Registry {
    'host-mode-state-service': HostModeStateService;
  }
}
