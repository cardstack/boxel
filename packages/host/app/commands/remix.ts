import { service } from '@ember/service';

import { v4 as uuidv4 } from 'uuid';
import deburr from 'lodash/deburr';

import {
  type ResolvedCodeRef,
  codeRefWithAbsoluteURL,
  isResolvedCodeRef,
  type CopyCardsWithCodeRef,
} from '@cardstack/runtime-common';
import * as BaseCommandModule from 'https://cardstack.com/base/command';

import * as CardAPI from 'https://cardstack.com/base/card-api';

import { timeout } from 'ember-concurrency';

import HostBaseCommand from '../lib/host-base-command';
import CopyCardCommand from './copy-card';
import CopySourceCommand from './copy-source';
import SwitchSubmodeCommand from './switch-submode';
import UpdateCodePathWithSelectionCommand from './update-code-path-with-selection';
import UpdatePlaygroundSelectionCommand from './update-playground-selection';
import type RealmServerService from '../services/realm-server';

interface CopyMeta {
  sourceCodeRef: ResolvedCodeRef;
  targetCodeRef: ResolvedCodeRef;
}

function nameWithUuid(listingName?: string) {
  if (!listingName) {
    return '';
  }
  // sanitize the listing name, eg: Blog App -> blog-app
  const sanitizedListingName = deburr(listingName.toLocaleLowerCase())
    .replace(/ /g, '-')
    .replace(/'/g, '');
  const newPackageName = `${sanitizedListingName}-${uuidv4()}`;
  return newPackageName;
}
export class RemixCommand extends HostBaseCommand<
  typeof BaseCommandModule.RemixInput,
  typeof BaseCommandModule.RemixResult
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
    const { RemixInput } = commandModule;
    return RemixInput;
  }

  protected async run(
    input: BaseCommandModule.RemixInput,
  ): Promise<BaseCommandModule.RemixResult> {
    let realmUrls = this.realmServer.availableRealmURLs;
    let { realm: realmUrl, listing: listingInput } = input;

    let cardAPI = await this.loadCardAPI();
    let commandModule = await this.loadCommandModule();
    const { RemixResult } = commandModule;

    const listing = listingInput as any;

    // Make sure realm is valid
    if (!realmUrls.includes(realmUrl)) {
      throw new Error(`Invalid realm: ${realmUrl}`);
    }

    const copyMeta: CopyMeta[] = [];

    const localDir = nameWithUuid(listing.name);

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

      await new CopySourceCommand(this.commandContext).execute({
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
      const results = listing.examples.map((instance: CardAPI.CardDef) => {
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
            meta.sourceCodeRef.name ===
              (exampleCodeRef as ResolvedCodeRef).name,
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
        const { newCardId } = await new CopyCardCommand(
          this.commandContext,
        ).execute({
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

    if (listing.displayName === 'SkillListing') {
      await Promise.all(
        listing.skills.map((skill) =>
          new CopyCardCommand(this.commandContext).execute({
            sourceCard: skill,
            realm: realmUrl,
            localDir,
          }),
        ),
      );
    }

    if (selectedCodeRef) {
      const codePath = selectedCodeRef.module.concat('.gts');
      if (shouldPersistPlaygroundSelection && firstExampleCardId) {
        const moduleId = [selectedCodeRef.module, selectedCodeRef.name].join(
          '/',
        );
        await new UpdatePlaygroundSelectionCommand(this.commandContext).execute(
          {
            moduleId,
            cardId: firstExampleCardId,
            format: 'isolated',
            fieldIndex: undefined,
          },
        );

        await window.localStorage.setItem(
          'code-mode-panel-selections',
          JSON.stringify({
            [codePath]: 'playground',
          }),
        );
      }

      await new UpdateCodePathWithSelectionCommand(this.commandContext).execute(
        {
          codeRef: selectedCodeRef,
          localName: selectedCodeRef.name,
          fieldName: undefined,
        },
      );

      await timeout(1000);

      await new SwitchSubmodeCommand(this.commandContext).execute({
        submode: 'code',
        codePath: selectedCodeRef.module,
      });

      return new RemixResult({ success: true });
    }
    return new RemixResult({ success: false });
  }
}
