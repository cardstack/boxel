import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { Resource } from 'ember-resources';

import type { Stack } from '../components/operator-mode/interact-submode';
import type CardService from '../services/card-service';

interface Args {
  positional: [stacks: Stack[]];
}

export class StackBackgroundsResource extends Resource<Args> {
  @tracked value: (string | undefined | null)[] = [];
  @service declare cardService: CardService;

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
        let bottomMostCard = stack[0];
        return (await this.cardService.getRealmInfo(bottomMostCard.card))
          ?.backgroundURL;
      }),
    );
    this.value = result;
  }
}

export function stackBackgroundsResource(parent: { stacks: Stack[] }) {
  return StackBackgroundsResource.from(parent, () => [parent.stacks]);
}
