import RouterService from '@ember/routing/router-service';
import { scheduleOnce } from '@ember/runloop';
import Service, { service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import stringify from 'safe-stable-stringify';

import { TrackedArray } from 'tracked-built-ins';

import RealmService from './realm';

interface InitializeOptions {
  primaryCardId: string | null;
  stack: string[];
  routePath: string;
}

type SerializedStack = string[];

export default class HostModeStateService extends Service {
  @service declare router: RouterService;
  @service declare realm: RealmService;

  // The primary card comes from the main path segment of the URL.
  // The stack cards come from the `hostModeStack` query param.
  // Example:
  // URL: https://user.example.com/cards/123.json?hostModeStack=https%3A%2F%2Fuser.example.com%2Fcards%2F456.json,https%3A%2F%2Fuser.example.com%2Fcards%2F789.json
  // Primary card ID: https://user.example.com/cards/123
  // Stack card IDs: [https://user.example.com/cards/456, https://user.example.com/cards/789]
  @tracked private primaryCardItem: string | null = null;
  private stackCardItems: TrackedArray<string> = new TrackedArray();
  private currentRoutePath: string | null = null;
  private isStateInitialized = false;

  restore({
    primaryCardId,
    serializedStack,
    routePath,
  }: {
    primaryCardId: string | null;
    serializedStack?: string | null;
    routePath?: string | null;
  }) {
    let stack = this.deserialize(serializedStack);

    this.initialize({
      primaryCardId,
      stack,
      routePath: routePath ?? '',
    });
  }

  private initialize({ primaryCardId, stack, routePath }: InitializeOptions) {
    if (this.isStateInitialized) {
      return;
    }
    this.isStateInitialized = false;
    this.primaryCardItem = primaryCardId ?? null;
    this.stackCardItems.push(...stack);
    this.currentRoutePath = routePath;
    this.isStateInitialized = true;
  }

  get stackItems() {
    return this.stackCardItems;
  }

  get primaryCard(): string | null {
    return this.primaryCardItem ?? null;
  }

  setPrimaryCard(cardId: string | null) {
    if (!this.isStateInitialized) {
      return;
    }

    this.primaryCardItem = cardId ?? null;
    this.schedulePersist();
  }

  pushCard(cardId: string) {
    this.stackCardItems.push(cardId);
    this.schedulePersist();
  }

  removeCardFromStack(cardId: string) {
    let index = this.stackCardItems.findIndex((item) => item === cardId);

    if (index !== -1) {
      this.stackCardItems.splice(index, 1);
      this.schedulePersist();
    }
  }

  private deserialize(serialized: string | undefined | null): string[] {
    if (!serialized) {
      return [];
    }

    try {
      return JSON.parse(serialized) as SerializedStack;
    } catch (error) {
      // Ignore malformed data and reset stack
    }

    return [];
  }

  serialize(): string | undefined {
    if (this.stackCardItems.length === 0) {
      return undefined;
    }

    return stringify(this.stackCardItems) ?? undefined;
  }

  private schedulePersist() {
    if (!this.isStateInitialized) {
      return;
    }

    scheduleOnce('afterRender', this, this.persist);
  }

  private persist() {
    if (!this.isStateInitialized || !this.currentRoutePath) {
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
