import { service } from '@ember/service';

import { resolveAdoptsFrom } from '@cardstack/runtime-common/code-ref';
import { realmURL } from '@cardstack/runtime-common/constants';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import { GenerateExampleCardsOneShotCommand } from './generate-example-cards';

import type RealmService from '../services/realm';

export default class GenerateListingExampleCommand extends HostBaseCommand<
  typeof BaseCommandModule.GenerateListingExampleInput,
  typeof BaseCommandModule.CreateInstanceResult
> {
  @service declare private realm: RealmService;

  static actionVerb = 'Generate Example';
  description = 'Generate a new example card for the listing and link it.';

  requireInputFields = ['listing', 'referenceExample'];

  async getInputType() {
    const commandModule = await this.loadCommandModule();
    const { GenerateListingExampleInput } = commandModule;
    return GenerateListingExampleInput;
  }

  protected async run(
    input: BaseCommandModule.GenerateListingExampleInput,
  ): Promise<BaseCommandModule.CreateInstanceResult> {
    const listing = input.listing as CardDef | undefined;
    if (!listing || !listing.id) {
      throw new Error('Listing card is required and must have an id');
    }

    const referenceExample = input.referenceExample as CardDef | undefined;
    if (!referenceExample) {
      throw new Error('Listing must include a reference example');
    }

    const codeRef = resolveAdoptsFrom(referenceExample);
    if (!codeRef) {
      throw new Error(
        'Unable to resolve card definition from reference example',
      );
    }

    const targetRealm =
      input.realm ||
      (referenceExample as any)[realmURL]?.href ||
      listing[realmURL]?.href ||
      this.realm.defaultWritableRealm?.path;

    const generator = new GenerateExampleCardsOneShotCommand(
      this.commandContext,
    );

    const result = await generator.execute({
      codeRef,
      realm: targetRealm,
      count: 1,
      exampleCard: referenceExample,
    });
    const createdExample = result.createdCard as CardDef | undefined;
    if (!createdExample) {
      throw new Error('Failed to create example card for listing');
    }

    this.linkListingExample(listing, createdExample);
    return result;
  }

  private linkListingExample(listing: CardDef, exampleCard: CardDef) {
    // TODO: autoSave should take over persisting this relationship; for now we only update the local instance.
    const currentExamples = Array.isArray((listing as any).examples)
      ? [...((listing as any).examples as CardDef[])]
      : [];
    currentExamples.push(exampleCard);
    (listing as any).examples = currentExamples;
  }
}
