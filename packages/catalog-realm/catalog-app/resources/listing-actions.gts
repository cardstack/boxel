import { resource } from 'ember-resources';
import { CardContext } from 'https://cardstack.com/base/card-api';
import { Listing } from '../listing/listing';
import {
  resolveListingActions,
  type ListingActions,
} from './helpers/listing-action-resolver';
export type {
  ListingActions,
  SkillActions,
  StubActions,
  RegularActions,
  ThemeActions,
} from './helpers/listing-action-resolver';

type ResourceState = Ready | Error;

export interface Ready {
  state: 'ready';
  actions: ListingActions;
}

export interface Error {
  state: 'error';
}

export function listingActions(
  parent: { args: { context?: CardContext | undefined } },
  input: () => { listing: Listing | undefined },
) {
  return resource<ResourceState>(parent, () => {
    const { listing } = input();
    let context = parent.args.context;
    if (!parent || !context || !listing) {
      return {
        state: 'error',
      };
    }
    let actions = resolveListingActions(listing, context);
    return {
      state: 'ready',
      actions,
    };
  });
}

export function isReady(resource: ResourceState): resource is Ready {
  return resource?.state === 'ready';
}
