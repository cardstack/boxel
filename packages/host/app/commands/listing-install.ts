import { service } from '@ember/service';

import {
  type ResolvedCodeRef,
  codeRefWithAbsoluteURL,
  isResolvedCodeRef,
  type CopyCardsWithCodeRef,
  type Command,
  listingNameWithUuid,
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

interface CopyMeta {
  sourceCodeRef: ResolvedCodeRef;
  targetCodeRef: ResolvedCodeRef;
}

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
}

export async function installListing({
  realmUrl,
  listing,
  commandContext,
  cardAPI,
}: InstallListingInput): Promise<InstallListingResult> {
  const copyMeta: CopyMeta[] = [];

  const localDir = listingNameWithUuid(listing.name);

  // first spec as the selected code ref with new url
  // if there are examples, take the first example's code ref
  let selectedCodeRef;
  let shouldPersistPlaygroundSelection = false;
  let firstExampleCardId;

  // Copy the gts file based on the attached spec's moduleHref
  for (const spec of listing.specs ?? []) {
    const absoluteModulePath = spec.moduleHref;
    const relativeModulePath = spec.ref.module;
    const normalizedPath = relativeModulePath.split('/').slice(2).join('/');
    const newPath = localDir.concat('/').concat(normalizedPath);
    const fileTargetUrl = new URL(newPath, realmUrl).href;
    const targetFilePath = fileTargetUrl.concat('.gts');

    await new CopySourceCommand(commandContext).execute({
      fromRealmUrl: absoluteModulePath,
      toRealmUrl: targetFilePath,
    });

    copyMeta.push({
      sourceCodeRef: {
        module: absoluteModulePath,
        name: spec.ref.name,
      },
      targetCodeRef: {
        module: fileTargetUrl,
        name: spec.ref.name,
      },
    });

    if (!selectedCodeRef) {
      selectedCodeRef = {
        module: fileTargetUrl,
        name: spec.ref.name,
      };
    }
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
      let maybeCopyMeta = copyMeta.find(
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

  if ('skills' in listing && Array.isArray(listing.skills)) {
    await Promise.all(
      listing.skills.map((skill: Skill) =>
        new CopyCardCommand(commandContext).execute({
          sourceCard: skill,
          realm: realmUrl,
          localDir,
        }),
      ),
    );
  }

  return {
    selectedCodeRef,
    shouldPersistPlaygroundSelection,
    firstExampleCardId,
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
