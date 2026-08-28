import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { Resource } from 'ember-modify-based-class-resource';

import { rri } from '@cardstack/runtime-common';

import type { Stack } from '../components/operator-mode/interact-submode';
import type RealmService from '../services/realm';

interface Args {
  positional: [stacks: Stack[]];
}

export class StackBackgroundsResource extends Resource<Args> {
  @tracked value: (string | undefined | null)[] = [];
  @service declare realm: RealmService;

  get backgroundImageURLs() {
    return this.value?.map((u) => (u ? u : undefined)) ?? [];
  }

  get hasDifferingBackgroundURLs() {
    let { backgroundImageURLs } = this;
    return (
      backgroundImageURLs &&
      backgroundImageURLs.length > 1 &&
      backgroundImageURLs.some(
        (u) => u === null || backgroundImageURLs[0] !== u,
      )
    );
  }

  get differingBackgroundImageURLs() {
    if (!this.hasDifferingBackgroundURLs) {
      return [];
    }
    return this.backgroundImageURLs;
  }

  async modify(positional: Args['positional'], _named: never) {
    let [stacks] = positional;
    let result = await Promise.all(
      stacks.map(async (stack) => {
        if (stack.length === 0) {
          this.value = [];
          return;
        }
        let bottomMostStackItem = stack[0];
        if (!bottomMostStackItem.id) {
          return;
        }
        // Background chrome depends only on the resource's realm, not on a
        // live card instance. Loading the bottom card through Store here used
        // to execute authored code in the Host before the stack's execution
        // admission resource could route it to Sandbox.
        let realm = this.realm.realmOf(rri(bottomMostStackItem.id));
        if (!realm) {
          return undefined;
        }
        await this.realm.ensureRealmMeta(realm);
        return this.realm.info(realm)?.backgroundURL;
      }),
    );
    this.value = result;
  }
}

export function stackBackgroundsResource(parent: { stacks: Stack[] }) {
  return StackBackgroundsResource.from(parent, () => [parent.stacks]);
}
