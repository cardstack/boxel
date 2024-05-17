import {
  Loader,
  type LooseCardResource,
  identifyCard,
  loadCard,
  humanReadable,
} from '@cardstack/runtime-common';
import { type SerializeOpts } from './storage';
import { isEqual } from 'lodash';
import { type BaseDefConstructor, type BaseDef } from '../-base-def';

export function makeRelativeURL(
  maybeURL: string,
  opts?: SerializeOpts,
): string {
  return opts?.maybeRelativeURL ? opts.maybeRelativeURL(maybeURL) : maybeURL;
}

export interface Options {
  computeVia?: string | (() => unknown);
  description?: string;
  // there exists cards that we only ever run in the host without
  // the isolated renderer (RoomField), which means that we cannot
  // use the rendering mechanism to tell if a card is used or not,
  // in which case we need to tell the runtime that a card is
  // explictly being used.
  isUsed?: true;
}

export async function cardClassFromResource<CardT extends BaseDefConstructor>(
  resource: LooseCardResource | undefined,
  fallback: CardT,
  relativeTo: URL | undefined,
): Promise<CardT> {
  let cardIdentity = identifyCard(fallback);
  if (!cardIdentity) {
    throw new Error(
      `bug: could not determine identity for card '${fallback.name}'`,
    );
  }
  if (resource && !isEqual(resource.meta.adoptsFrom, cardIdentity)) {
    let loader = Loader.getLoaderFor(fallback);

    if (!loader) {
      throw new Error('Could not find a loader, this should not happen');
    }

    let card: typeof BaseDef | undefined = await loadCard(
      resource.meta.adoptsFrom,
      { loader, relativeTo: resource.id ? new URL(resource.id) : relativeTo },
    );
    if (!card) {
      throw new Error(
        `could not find card: '${humanReadable(resource.meta.adoptsFrom)}'`,
      );
    }
    return card as CardT;
  }
  return fallback;
}
