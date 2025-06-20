import { service } from '@ember/service';

import {
  type ResolvedCodeRef,
  codeRefWithAbsoluteURL,
  isResolvedCodeRef,
  type CopyCardsWithCodeRef,
  type Command,
  listingNameWithUuid,
  planInstall,
  guessSourceRealm,
  toKebabCase,
  RealmPaths,
} from '@cardstack/runtime-common';

import * as CardAPI from 'https://cardstack.com/base/card-api';
import * as BaseCommandModule from 'https://cardstack.com/base/command';

import type { Skill } from 'https://cardstack.com/base/skill';

import HostBaseCommand from '../lib/host-base-command';

import CopyCardCommand from './copy-card';
import CopySourceCommand from './copy-source';

import type RealmServerService from '../services/realm-server';
import type { Listing } from '@cardstack/catalog/listing/listing';

interface InstallListingInput {
  realmUrl: string;
  listing: Listing;
  commandContext: Command<
    typeof BaseCommandModule.ListingInput
  >['commandContext'];
  cardAPI: typeof CardAPI;
}

interface InstallListingResult {
  selectedCodeRef?: ResolvedCodeRef;
  shouldPersistPlaygroundSelection: boolean;
  firstExampleCardId?: string;
  skillCardIds?: string[];
}

export async function installListing({
  realmUrl,
  listing,
  commandContext,
  cardAPI,
}: InstallListingInput): Promise<InstallListingResult> {
  const sourceDirName = toKebabCase(listing.name);
  const localDir = listingNameWithUuid(listing.name);

  if (listing.specs.length == 0) {
    throw new Error('No specs exist on listing');
  }

  let sourceRealm = guessSourceRealm(listing.specs);
  if (!sourceRealm) {
    throw new Error('Cannot derive realm from listing');
  }
  // this checks if the listing is wrapped in a directory
  let sourceDir = `${sourceRealm}${sourceDirName}/`;

  // first spec as the selected code ref with new url
  // if there are examples, take the first example's code ref
  let shouldPersistPlaygroundSelection = false;
  let firstExampleCardId;

  let copyMetas = planInstall(realmUrl, listing.specs, {
    targetDirName: localDir,
    sourceDir: sourceDir,
  });
  let selectedCodeRef = copyMetas[0].targetCodeRef;
  for (const { sourceCodeRef, targetCodeRef } of copyMetas) {
    await new CopySourceCommand(commandContext).execute({
      fromRealmUrl: sourceCodeRef.module,
      toRealmUrl: targetCodeRef.module,
    });
  }

  if (listing.examples) {
    // Create serialized objects for each example with modified adoptsFrom
    const results = listing.examples.map((instance) => {
      let adoptsFrom = instance[cardAPI.meta]?.adoptsFrom;
      if (!adoptsFrom) {
        return null;
      }
      let exampleCodeRef = instance.id
        ? codeRefWithAbsoluteURL(adoptsFrom, new URL(instance.id))
        : adoptsFrom;
      if (!isResolvedCodeRef(exampleCodeRef)) {
        throw new Error('exampleCodeRef is NOT resolved');
      }
      let maybeCopyMeta = copyMetas.find(
        (meta) =>
          meta.sourceCodeRef.module ===
            (exampleCodeRef as ResolvedCodeRef).module &&
          meta.sourceCodeRef.name === (exampleCodeRef as ResolvedCodeRef).name,
      );
      if (maybeCopyMeta) {
        if (!shouldPersistPlaygroundSelection) {
          selectedCodeRef = maybeCopyMeta.targetCodeRef;
          shouldPersistPlaygroundSelection = true;
        }

        return {
          sourceCard: instance,
          codeRef: maybeCopyMeta.targetCodeRef,
        };
      }
      return null;
    });
    const copyCardsWithCodeRef = results.filter(
      (result) => result !== null,
    ) as CopyCardsWithCodeRef[];
    for (const cardWithNewCodeRef of copyCardsWithCodeRef) {
      const { newCardId } = await new CopyCardCommand(commandContext).execute({
        sourceCard: cardWithNewCodeRef.sourceCard,
        realm: realmUrl,
        localDir,
        codeRef: cardWithNewCodeRef.codeRef,
      });
      if (!firstExampleCardId) {
        firstExampleCardId = newCardId;
      }
    }
  }

  let skillCardIds: string[] | undefined;
  if ('skills' in listing && Array.isArray(listing.skills)) {
    let results = await Promise.all(
      listing.skills.map((skill: Skill) => {
        return new CopyCardCommand(commandContext).execute({
          sourceCard: skill,
          realm: realmUrl,
          localDir,
        });
      }),
    );
    skillCardIds = results.map((r) => r.newCardId);
  }

  return {
    selectedCodeRef,
    shouldPersistPlaygroundSelection,
    firstExampleCardId,
    skillCardIds,
  };
}

export default class ListingInstallCommand extends HostBaseCommand<
  typeof BaseCommandModule.ListingInput
> {
  @service declare private realmServer: RealmServerService;

  #cardAPI?: typeof CardAPI;

  async loadCardAPI() {
    if (!this.#cardAPI) {
      this.#cardAPI = await this.loaderService.loader.import<typeof CardAPI>(
        'https://cardstack.com/base/card-api',
      );
    }
    return this.#cardAPI;
  }

  description =
    'Install catalog listing with bringing them to code mode, and then remixing them via AI';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { ListingInput } = commandModule;
    return ListingInput;
  }

  protected async run(
    input: BaseCommandModule.ListingInput,
  ): Promise<undefined> {
    let realmUrls = this.realmServer.availableRealmURLs;
    let { realm, listing: listingInput } = input;

    let realmUrl = new RealmPaths(new URL(realm)).url;

    // Make sure realm is valid
    if (!realmUrls.includes(realmUrl)) {
      throw new Error(`Invalid realm: ${realmUrl}`);
    }

    // this is intentionally to type because base command cannot interpret Listing type from catalog
    const listing = listingInput as Listing;
    const cardAPI = await this.loadCardAPI();

    await installListing({
      realmUrl,
      listing,
      commandContext: this.commandContext,
      cardAPI,
    });
  }
}
