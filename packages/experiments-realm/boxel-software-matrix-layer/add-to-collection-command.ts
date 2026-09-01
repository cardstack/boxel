import { Command } from '@cardstack/runtime-common';
import {
  CardDef,
  StringField,
  contains,
  field,
  realmURL,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import AmountWithCurrency from '@cardstack/base/amount-with-currency';
import CurrencyField from '@cardstack/base/currency';
import GetCardCommand from '@cardstack/boxel-host/commands/get-card';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import { CollectionItem } from './collection-item';
import { ConditionGrade } from './condition-grade';
import { Acquisition } from './acquisition';

export class AddToCollectionInput extends CardDef {
  @field productId = contains(StringField);
  @field ownerId = contains(StringField);
  @field variant = contains(StringField);
  @field variantScale = contains(StringField);
  @field packaging = contains(StringField);
  // condition
  @field conditionCode = contains(StringField);
  @field conditionValueRetention = contains(NumberField);
  @field conditionNotes = contains(StringField);
  // acquisition
  @field acquisitionPrice = contains(NumberField);
  @field acquisitionCurrency = contains(StringField);
  @field acquisitionSource = contains(StringField);
  @field acquisitionReference = contains(StringField);
}

export class AddToCollectionResult extends CardDef {
  @field collectionItemId = contains(StringField);
}

// Add To Collection (AC) — a new owned copy enters someone's vault.
//
// The condition scale is the CALLER'S vocabulary, never hardcoded here —
// `condition-grade.gts`'s own header note is explicit that this field names
// no grading scale (DS/VNDS/9-10 is a sneaker convention, not the block's).
// This command just carries whatever `conditionCode` the caller supplies
// straight through.
export default class AddToCollectionCommand extends Command<
  typeof AddToCollectionInput,
  typeof AddToCollectionResult
> {
  static actionVerb = 'Add to collection';
  description =
    'Catalogue a new owned copy of a product, with its condition and acquisition details.';

  async getInputType() {
    return AddToCollectionInput;
  }

  protected async run(
    input: AddToCollectionInput,
  ): Promise<AddToCollectionResult> {
    let productId = input.productId?.trim();
    let ownerId = input.ownerId?.trim();
    if (!productId) {
      throw new Error('productId is required');
    }
    if (!ownerId) {
      throw new Error('ownerId is required');
    }

    let product = await new GetCardCommand(this.toolContext).execute({
      cardId: productId,
    });
    if (!product) {
      throw new Error(`Product not found: ${productId}`);
    }
    let owner = await new GetCardCommand(this.toolContext).execute({
      cardId: ownerId,
    });
    if (!owner) {
      throw new Error(`Owner not found: ${ownerId}`);
    }

    let item = new CollectionItem();
    item.item = product;
    item.owner = owner as any;
    item.variant = input.variant?.trim() || '';
    item.variantScale = input.variantScale?.trim() || '';
    item.packaging = input.packaging?.trim() || '';

    let condition = new ConditionGrade();
    condition.code = input.conditionCode?.trim() || '';
    if (input.conditionValueRetention != null) {
      condition.valueRetention = input.conditionValueRetention;
    }
    condition.notes = input.conditionNotes?.trim() || '';
    item.condition = condition;

    let acquisition = new Acquisition();
    if (input.acquisitionPrice != null) {
      acquisition.price = new AmountWithCurrency({
        amount: input.acquisitionPrice,
        currency: new CurrencyField({
          code: input.acquisitionCurrency?.trim() || 'USD',
        }),
      });
    }
    acquisition.acquiredOn = new Date();
    acquisition.source = input.acquisitionSource?.trim() || '';
    acquisition.reference = input.acquisitionReference?.trim() || '';
    item.acquisition = acquisition;

    // Save into the SOURCE card's own realm. Without `realm`, SaveCard
    // defaults to the base realm and the write 401s — verified live when a
    // ProcessPayment run tried to save its Payment to cardstack.com/base/.
    let realm = (product as any)?.[realmURL]?.href;
    let saved = (await new SaveCardCommand(this.toolContext).execute({
      card: item,
      realm,
    })) as CollectionItem;

    let result = new AddToCollectionResult();
    result.collectionItemId = saved.id;
    return result;
  }
}
