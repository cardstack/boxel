import type Owner from '@ember/owner';
import type RouterService from '@ember/routing/router-service';
import { scheduleOnce } from '@ember/runloop';
import Service, { service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import stringify from 'safe-stable-stringify';

import { TrackedArray } from 'tracked-built-ins';

import { removeTopmost, unwindOrPush } from '../utils/host-mode-stack';

import type RealmService from './realm';
import type SessionService from './session';

interface InitializeOptions {
  primaryCardId: string | null;
  stack: string[];
  routePath: string;
}

type SerializedStack = string[];

export default class HostModeStateService extends Service {
  @service declare router: RouterService;
  @service declare realm: RealmService;
  @service declare session: SessionService;

  // The primary card comes from the main path segment of the URL.
  // The stack cards come from the `hostModeStack` query param.
  // Example:
  // URL: https://user.example.com/cards/123.json?hostModeStack=https%3A%2F%2Fuser.example.com%2Fcards%2F456.json,https%3A%2F%2Fuser.example.com%2Fcards%2F789.json
  // Primary card ID: https://user.example.com/cards/123
  // Stack card IDs: [https://user.example.com/cards/456, https://user.example.com/cards/789]
  @tracked private primaryCardItem: string | null = null;
  private readonly stackCardItems: TrackedArray<string> = new TrackedArray();
  private currentRoutePath: string | null = null;
  private isStateInitialized = false;

  constructor(owner: Owner) {
    super(owner);
    this.session.register(this);
  }

  resetState() {
    this.primaryCardItem = null;
    // emptied in place: the field isn't tracked, so a template that has read
    // the stack keeps the array it read
    this.stackCardItems.splice(0, this.stackCardItems.length);
    this.currentRoutePath = null;
    this.isStateInitialized = false;
  }

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

  // The URL is the source of truth for the stack. Every transition into the
  // route lands here: the first load, the transition `persist` makes for a
  // change made here (whose URL already matches, so nothing changes), and the
  // browser's Back and Forward, whose URL holds a different stack that the
  // page has to follow.
  private initialize({ primaryCardId, stack, routePath }: InitializeOptions) {
    // a tracked write invalidates even when the value is the same, and the
    // primary card's resources rebuild on it, so only a change is written
    let primaryCard = primaryCardId ?? null;
    if (this.primaryCardItem !== primaryCard) {
      this.primaryCardItem = primaryCard;
    }
    if (
      this.stackCardItems.length !== stack.length ||
      this.stackCardItems.some((id, index) => id !== stack[index])
    ) {
      this.stackCardItems.splice(0, this.stackCardItems.length, ...stack);
    }
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
    unwindOrPush(this.stackCardItems, cardId, this.primaryCardItem);
    this.schedulePersist();
  }

  removeCardFromStack(cardId: string) {
    if (removeTopmost(this.stackCardItems, cardId)) {
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
    if (!this.isStateInitialized || this.currentRoutePath === null) {
      return;
    }

    // Preserve the param if there is a stack, otherwise remove it to keep the URL clean.
    let queryParams = { hostModeStack: this.serialize() };
    // A site's root page has no path: it is the index-root route, which the
    // index route's path can't name.
    if (this.currentRoutePath) {
      this.router.transitionTo('index', this.currentRoutePath, { queryParams });
    } else {
      this.router.transitionTo('index-root', { queryParams });
    }
  }
}

declare module '@ember/service' {
  interface Registry {
    'host-mode-state-service': HostModeStateService;
  }
}
