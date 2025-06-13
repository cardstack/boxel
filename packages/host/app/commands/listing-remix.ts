import { service } from '@ember/service';

import { timeout } from 'ember-concurrency';
import window from 'ember-window-mock';

import { isResolvedCodeRef, RealmPaths } from '@cardstack/runtime-common';

import { ModuleInspectorSelections } from '@cardstack/host/utils/local-storage-keys';

import * as CardAPI from 'https://cardstack.com/base/card-api';
import * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import { installListing } from './listing-install';
import SwitchSubmodeCommand from './switch-submode';
import UpdateCodePathWithSelectionCommand from './update-code-path-with-selection';
import UpdatePlaygroundSelectionCommand from './update-playground-selection';

import type OperatorModeStateService from '../services/operator-mode-state-service';
import type RealmServerService from '../services/realm-server';
import type { Listing } from '@cardstack/catalog/listing/listing';

export default class RemixCommand extends HostBaseCommand<
  typeof BaseCommandModule.ListingInput
> {
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'Remix';

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

    const {
      selectedCodeRef,
      shouldPersistPlaygroundSelection,
      firstExampleCardId,
      skillCardIds,
    } = await installListing({
      realmUrl,
      listing,
      commandContext: this.commandContext,
      cardAPI,
    });
    if (selectedCodeRef && isResolvedCodeRef(selectedCodeRef)) {
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

        this.operatorModeStateService.persistModuleInspectorView(
          codePath,
          'preview',
        );
      }

      await new UpdateCodePathWithSelectionCommand(this.commandContext).execute(
        {
          codeRef: selectedCodeRef,
          localName: selectedCodeRef.name,
          fieldName: undefined,
        },
      );

      // before switching to code mode, the FileResource is not ready immediately for the selected file
      // so we need to wait for 1 second before switching to code mode to ensure the file is ready for now
      await timeout(1000);

      await new SwitchSubmodeCommand(this.commandContext).execute({
        submode: 'code',
        codePath: selectedCodeRef.module,
      });
    } else if ('skills' in listing) {
      // A listing can have more than one skill
      // The most optimum way for remixing is still to display only the first instance
      let firstSkillCardId =
        skillCardIds && skillCardIds.length > 0 ? skillCardIds[0] : undefined;
      if (firstSkillCardId) {
        await new SwitchSubmodeCommand(this.commandContext).execute({
          submode: 'code',
          codePath: firstSkillCardId,
        });
      }
    }
  }
}
