import {
  CardDef,
  Component,
  FieldDef,
  StringField,
  contains,
  containsMany,
  field,
  linksTo,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import DateField from 'https://cardstack.com/base/date';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import CodeRef from '../../base/code-ref';
import { Price } from './price';
import { Offer } from './offer';
import MarkdownField from '../../base/markdown';
import { IconCard } from '../../base/catalog-entry';
import { Base64ImageCard } from '../base64-image-card';
import { Author } from '../author';

export default class Example extends FieldDef {
  @field info = contains(StringField);
  @field linksTo = linksTo(CardDef); // linking to the code ref of the Listing app card
  @field contains = contains(FieldDef); // if type is field then use contains

  static embedded = class Embedded extends Component<typeof this> {
    get isCard() {
      return this.args.model.linksTo !== undefined;
    }

    get isField() {
      return this.args.model.contains !== undefined;
    }
    <template>
      <strong>{{@model.info}}</strong>
      {{#if this.isCard}}
        {{@fields.linksTo}}
      {{else if this.isField}}
        {{@fields.contains}}
      {{else}}
        No examples to display
      {{/if}}
    </template>
  };
}

// Boxel Spec is used to define the schema of a boxel module (as instances)
// - links to the module
// - tells if its a card or field or command or app card
// - documentation of what the schema or field is. provide links to instances that are examples
// - realm
// - created from the code itself
// - replacing catalog entries
export class BoxelSpec extends CardDef {
  @field name = contains(StringField); //TODO change to name
  @field tagLine = contains(StringField);
  @field icon = linksTo(IconCard); //set of svg icon in catalog/reference realm
  @field readMe = contains(MarkdownField);

  @field examples = containsMany(Example);
  // card choooser has to filter by the type exported in code ref
  // maybe uses computeVia
  @field ref = contains(CodeRef); // resolved code ref
}

export class Category extends CardDef {
  static displayName = 'Category';
  @field name = contains(StringField);
  @field code = contains(StringField);

  @field parent = linksTo(() => Category); // support nested directory structure
  // @field offers = linksToMany(Offer);// put this here bcos we want to apply offer to everything in a category. But we need query based relationship

  @field title = contains(StringField, {
    computeVia: function (this: Category) {
      return this.name;
    },
  });
}

export class Tag extends CardDef {
  static displayName = 'Tag';
  @field kind = contains(StringField); //color, language
  @field value = contains(StringField); //red, english
  // @field offers = linksToMany(Offer);// this is here bcos we want to apply offer to everything in a tag, but we need query based relationships
}

export class Listing extends CardDef {
  static displayName = 'Listing Card';
  //==Listing info
  @field name = contains(StringField);
  @field detail = contains(StringField);
  @field publishDate = contains(DateField);
  @field publisher = linksTo(Author);

  //==Listing spec
  @field spec = linksTo(BoxelSpec);

  //==Listing categories
  @field tags = linksToMany(Tag); // Tags are used is to navigate store and apply offers to list of listings

  @field primaryCategory = linksTo(Category);
  @field secondaryCategory = linksTo(Category);

  //==Listing examples
  @field examples = containsMany(Example); // these pertain to examples in listing (they are instances ). It may be different from examples in code spec.
  @field images = linksToMany(Base64ImageCard);

  /**
   * ==Listing relationships with other listings
   * 1. bundles (Parent to Child):
   *    - Indicates other listings included in this listing
   *    - One-way association: Parent listing can include or bundle child listings
   *    - Condition: Both parent and child must be from the same Publisher
   *    - Use case: "Includes the benefits of" relationships
   *
   * Note:
   * - Reciprocal associations (e.g., bundles by different publishers) are not implemented yet and would require mutual agreement
   */
  @field bundles = linksToMany(() => Listing);

  //==Listing pricing
  @field basePrice = contains(Price); // price used to compute discounts
  @field priceOptions = containsMany(Price); // this is to display the price options on the ui. In the future, this will be a computed field that gets price from a list of offers but for now we are keeping complex-logic insde the price card. Although we will still emit Price and use that as an interface for display.
  @field offers = linksToMany(Offer);

  //==Listing inventory
  @field doYouWantToTrackQuantity = contains(BooleanField);
  @field quantityAvailable = contains(NumberField);
  @field quantitySold = contains(NumberField);

  static isolated = class Isolated extends Component<typeof Listing> {
    <template>
      <div>
        <h2> Listing info</h2>
        <div>
          <h4>Name</h4>
          {{@model.name}}
          <h4>Detail</h4>
          {{@model.detail}}
          PublishDate>:
          <@fields.publishDate />
          Publisher:
          <@fields.publisher />
        </div>
        <h2> Listing spec</h2>
        <h2> Listing categories</h2>
        <div>
          {{#each @fields.tags as |tag|}}
            <tag />
          {{/each}}
          {{@model.primaryCategory.name}}
          {{@model.secondaryCategory.name}}
        </div>
        <h2> Listing examples</h2>
        <h2> Listing relationships</h2>
        <h2> Listing pricing</h2>
        <div>
          <h4>Price options</h4>
          {{#each @fields.priceOptions as |option|}}
            <option />
          {{/each}}
          <h4> Offers </h4>
          {{#each @fields.offers as |offer|}}
            <offer />
          {{/each}}
          <h2> Listing inventory</h2>
          <h4>Base price</h4>

          {{@model.basePrice.value.currency.sign}}
          {{@model.basePrice.value.amount}}
        </div>

        <h2>Listing inventory</h2>
        <div>
          {{@model.doYouWantToTrackQuantity}}
          {{@model.quantitySold}}
          /
          {{@model.quantityAvailable}}
        </div>
      </div>
    </template>
  };
}

export class FieldListing extends Listing {}
export class CardListing extends Listing {}
export class CommandListing extends Listing {}
export class SkillListing extends Listing {}
export class BotListing extends Listing {}
// the reason we have this membership listing is to ensure that memberships are searchable when ppl want to buy something from the catalog
export class MembershipListing extends Listing {
  @field providesBenefitsTo = linksTo(() => MembershipListing); //always honor from parent to child
}
export class PledgeListing extends Listing {
  // @field stage = contains(StageField); //for crowd funding, pre order, coming soon etc
}
