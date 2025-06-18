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

import { join } from '@cardstack/runtime-common/paths';

import * as CardAPI from 'https://cardstack.com/base/card-api';
import * as BaseCommandModule from 'https://cardstack.com/base/command';

import type { Skill } from 'https://cardstack.com/base/skill';
import { Spec } from 'https://cardstack.com/base/spec';

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
  skillCardIds?: string[];
}

function planModuleInstall(
  spec: Spec,
  sourceRealm: RealmPaths,
  targetRealm: string,
  targetDirName?: string,
): CopyMeta {
  let sourcePaths = new RealmPaths(new URL(sourceRealm));
  let localPath = sourcePaths.local(new URL(spec.moduleHref));
  let targetModule =
    targetRealm + join(targetDirName ?? '', localPath + '.gts'); //we assume .gts extension for now

  return {
    sourceCodeRef: {
      name: spec.ref.name,
      module: spec.moduleHref, //its annoying that this doesn't have an extension
    },
    targetCodeRef: {
      name: spec.ref.name,
      module: targetModule,
    },
  };
}

interface InstallOpts {
  targetDirName?: string; //install into a directory with a name
  sourceDir?: string;
}

export function planInstall(
  specs: Spec[],
  targetRealm: string,
  opts: InstallOpts = {},
): CopyMeta[] {
  if (specs.length == 0) {
    throw new Error('There are no specs to install');
  }
  let realmPath = new RealmPaths(specs[0].realm);
  const allSpecsFromSameRealm = specs.every((spec) =>
    realmPath.inRealm(spec.realm),
  );
  if (!allSpecsFromSameRealm) {
    throw new Error('Cannot install listing. Specs are from different realm');
  }
  if (opts.sourceDir) {
    const sourceDirPath = new RealmPaths(new URL(opts.sourceDir));
    const allInDir = specs.every((spec) =>
      sourceDirPath.inRealm(new URL(spec.moduleHref)),
    );
    if (allInDir) realmPath = sourceDirPath.url;
  }

  return specs.map((spec) =>
    planModuleInstall(spec, realmPath, targetRealm, opts.targetDirName),
  );
}

export async function installListing({
  realmUrl,
  listing,
  commandContext,
  cardAPI,
}: InstallListingInput): Promise<InstallListingResult> {
  const { uuidName: localDir, name } = listingNameWithUuid(listing.name);

  // first spec as the selected code ref with new url
  // if there are examples, take the first example's code ref
  let shouldPersistPlaygroundSelection = false;
  let firstExampleCardId;

  let sourceDir = listing.specs[0].realm + name + '/';
  let copyMetas = planInstall(listing.specs, realmUrl, {
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
