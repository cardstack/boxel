import { service } from '@ember/service';

import { timeout } from 'ember-concurrency';

import { isResolvedCodeRef } from '@cardstack/runtime-common';

import * as CardAPI from 'https://cardstack.com/base/card-api';
import * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import ListingInstallCommand from './listing-install';
import SwitchSubmodeCommand from './switch-submode';
import UpdateCodePathWithSelectionCommand from './update-code-path-with-selection';
import UpdatePlaygroundSelectionCommand from './update-playground-selection';

import type RealmServerService from '../services/realm-server';

export default class RemixCommand extends HostBaseCommand<
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
    let { realm: realmUrl, listing: listingInput } = input;

    const {
      selectedCodeRef,
      shouldPersistPlaygroundSelection,
      firstExampleCardId,
    } = await new ListingInstallCommand(this.commandContext).execute({
      realm: realmUrl,
      listing: listingInput,
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

      // before switching to code mode, the FileResource is not ready immediately for the selected file
      // so we need to wait for 1 second before switching to code mode to ensure the file is ready for now
      await timeout(1000);

      await new SwitchSubmodeCommand(this.commandContext).execute({
        submode: 'code',
        codePath: selectedCodeRef.module,
      });
    }
  }
}
