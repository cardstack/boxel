import { service } from '@ember/service';

import { isResolvedCodeRef, RealmPaths } from '@cardstack/runtime-common';
import { DEFAULT_CODING_LLM } from '@cardstack/runtime-common/matrix-constants';

import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import { skillCardURL } from '../lib/utils';

import UseAiAssistantCommand from './ai-assistant';
import ListingInstallCommand from './listing-install';
import SwitchSubmodeCommand from './switch-submode';
import UpdateCodePathWithSelectionCommand from './update-code-path-with-selection';
import UpdatePlaygroundSelectionCommand from './update-playground-selection';

import type OperatorModeStateService from '../services/operator-mode-state-service';
import type RealmServerService from '../services/realm-server';
import type { Listing } from '@cardstack/catalog/listing/listing';

export default class RemixCommand extends HostBaseCommand<
  typeof BaseCommandModule.ListingInstallInput
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
    const { ListingInstallInput } = commandModule;
    return ListingInstallInput;
  }

  requireInputFields = ['realm', 'listing'];

  protected async run(
    input: BaseCommandModule.ListingInstallInput,
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

    const { selectedCodeRef, exampleCardId, skillCardId } =
      await new ListingInstallCommand(this.commandContext).execute({
        realm: realmUrl,
        listing,
      });
    if (selectedCodeRef && isResolvedCodeRef(selectedCodeRef)) {
      const codePath = selectedCodeRef.module;

      if (exampleCardId) {
        const moduleId = [selectedCodeRef.module, selectedCodeRef.name].join(
          '/',
        );
        await new UpdatePlaygroundSelectionCommand(this.commandContext).execute(
          {
            moduleId: moduleId,
            cardId: exampleCardId,
            format: 'isolated',
            fieldIndex: undefined,
          },
        );

        this.operatorModeStateService.persistModuleInspectorView(
          codePath + '.gts',
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
      await new SwitchSubmodeCommand(this.commandContext).execute({
        submode: 'code',
        codePath: selectedCodeRef.module,
      });
    } else if ('skills' in listing) {
      // A listing can have more than one skill
      // The most optimum way for remixing is still to display only the first instance
      if (skillCardId) {
        await new SwitchSubmodeCommand(this.commandContext).execute({
          submode: 'code',
          codePath: skillCardId,
        });
      }
    }

    let prompt =
      'Remix done! Please suggest two example prompts on how to edit this card.';

    const skillCardIds = [
      skillCardURL('boxel-environment'),
      skillCardURL('boxel-development'),
      skillCardURL('source-code-editing'),
      skillCardURL('catalog-listing'),
    ];
    await new UseAiAssistantCommand(this.commandContext).execute({
      roomId: 'new',
      prompt,
      openRoom: true,
      roomName: `Remixing ${listing.name ?? 'Listing'}  `,
      attachedCards: [listing],
      skillCardIds,
      llmModel: DEFAULT_CODING_LLM,
    });
  }
}
