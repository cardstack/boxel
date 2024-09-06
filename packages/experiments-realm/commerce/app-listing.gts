import { Listing } from './listing';
import {
  Component,
  field,
  contains,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import GlimmerComponent from '@glimmer/component';
import { RadioInput, Button } from '@cardstack/boxel-ui/components';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { fn } from '@ember/helper';
import { ImageLayout } from './image-gallery';
import { Price } from './price';
import { BoxelSpec } from './listing';
import BooleanField from 'https://cardstack.com/base/boolean';

interface PriceOptionWithId {
  id: string;
  priceOption: Price;
}

class Isolated extends Component<typeof AppListing> {
  @tracked selectedPriceOptionId: string = '0';

  @action
  onSelectPriceOption(id: string) {
    this.selectedPriceOptionId = id;
  }

  get priceOptionsWithId() {
    let priceOptions: Price[] = this.args.model?.priceOptions ?? [];
    return priceOptions.map((priceOption, index) => {
      return {
        id: index.toString(),
        priceOption: priceOption,
      };
    });
  }

  <template>
    <style>
      .app-listing {
        padding: 20px;
      }
      .app-listing-header {
        display: flex;
        align-items: center;
        margin-bottom: 20px;
      }
      .app-icon {
        width: 60px;
        height: 60px;
        background-color: #6666ff;
        border-radius: 12px;
        margin-right: 15px;
      }
      .app-info {
        flex-grow: 1;
      }
      .app-title {
        font-size: 24px;
        margin: 0;
      }
      .app-author {
        margin: 0;
        color: #666;
      }
      .add-to-workspace-btn {
      }
      .app-listing-content {
        display: flex;
        gap: 30px;
      }
      .app-details {
        flex: 2;
      }
      .app-pricing {
        flex: 1;
      }
      .pricing-options {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .price-option {
        display: flex;
        justify-content: space-between;
        align-items: center;
        width: 100%;
      }
      .price-label {
        font-weight: bold;
      }
      .price-amount {
        color: var(--boxel-purple);
      }
      .price-option input[type='radio'] {
        display: none;
      }
      .price-option.selected {
        border-color: #00cccc;
        background-color: #e6ffff;
      }
      .view-offers-btn {
        --boxel-button-text-color: black;
      }
      .app-meta {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
        color: #666;
        font-size: 14px;
      }
      .publish-date {
        font-style: italic;
      }
      .category-pills {
        display: flex;
        gap: 8px;
        margin-bottom: 16px;
      }

      .category-pill {
        background-color: #f0f0f0;
        border-radius: 12px;
        padding: 3px 10px;
        font-size: 12px;
        color: #333;
        display: inline-block;
      }

      .primary-category {
        background-color: #e6f7ff;
        color: #0066cc;
      }

      .secondary-category {
        background-color: #f6f6f6;
        color: #666;
      }
    </style>

    <div class='app-listing'>
      <div class='app-listing-header'>
        <div class='app-icon'>
          {{!-- {{#if @model.spec.firstObject.icon}}
            <@fields.spec.firstObject.icon />
          {{/if}} --}}
        </div>
        <div class='app-info'>
          <h1 class='app-title'>{{@model.name}}</h1>
          {{!-- <p class='app-author'>by {{@model.spec.firstObject.displayName}}</p> --}}
        </div>
        <Button
          @kind='primary'
          @size='medium'
          @variant='filled'
          class='add-to-workspace-btn'
        >
          Add to Workspace
        </Button>
      </div>

      <div class='app-meta'>
        <div class='publish-date'>Published: <@fields.publishDate /></div>
        {{! TODO: Replace with pill components from boxel }}
        <div class='category-pills'>
          <span
            class='category-pill primary-category'
          >{{@model.primaryCategory.name}}</span>
          <span
            class='category-pill secondary-category'
          >{{@model.secondaryCategory.name}}</span>
        </div>
      </div>

      <div class='app-listing-content'>
        <div class='app-details'>

          <section class='license-section'>
            <h2>License</h2>
            <div class='license'>License: MIT</div>
          </section>

          <section class='description-section'>
            <h2>Description</h2>
            <p>{{@model.detail}}</p>
          </section>

          <div>
            <h2>Images & Videos</h2>
            <ImageLayout @images={{@fields.images}} @displayFormat='grid' />
          </div>
          <div>
            <h2>Examples</h2>
            <@fields.examples />
          </div>
        </div>

        <div class='app-pricing'>
          <h2>Pricing</h2>
          <PriceOptions
            @options={{this.priceOptionsWithId}}
            @selectedPriceOptionId={{this.selectedPriceOptionId}}
            @onSelectRadio={{this.onSelectPriceOption}}
          />

        </div>
      </div>
    </div>
  </template>
}

interface PriceOptionsSignature {
  Args: {
    options: PriceOptionWithId[] | undefined;
    selectedPriceOptionId: string | undefined;
    onSelectRadio: (id: string) => void;
  };
  Element: HTMLElement;
}

export default class PriceOptions extends GlimmerComponent<PriceOptionsSignature> {
  <template>
    <RadioInput
      @items={{@options}}
      @name='price-option'
      @groupDescription='Select a price option '
      @orientation='vertical'
      @spacing='compact'
      @checkedId={{@selectedPriceOptionId}}
      as |item|
    >
      <item.component @onChange={{fn @onSelectRadio item.data.id}}>
        {{#let item.data.priceOption as |price|}}
          <div class='price-option'>
            <div class='cta'>
              <div class='label'>{{price.cta.label}}</div>
              {{#if price.cta.subLabel}}
                <div class='sublabel'>{{price.cta.subLabel}}</div>
              {{/if}}
            </div>
            <div class='price'>
              <span class='amount'>
                {{price.value.currency.sign}}
                {{price.value.amount}}</span>
            </div>
          </div>
        {{/let}}
      </item.component>
    </RadioInput>
    <style>
      .price-option {
        display: flex;
        justify-content: space-between;
        align-items: center;
        width: 100%;
        padding: var(--boxel-sp-sm);
        border-radius: var(--boxel-border-radius-sm);
      }
      .cta {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
      }
      .cta .label {
        font-weight: 600;
        font-size: var(--boxel-font-size-sm);
        color: var(--boxel-purple-700);
      }
      .cta .sublabel {
        font-size: var(--boxel-font-size-xs);
        color: var(--boxel-purple-400);
        margin-top: var(--boxel-sp-xxs);
      }
      .price {
        font-weight: 500;
        font-size: var(--boxel-font-size-sm);
        color: var(--boxel-purple-700);
      }
      .price .amount {
        color: var(--boxel-purple);
      }
    </style>
  </template>
}

class AppBoxelSpec extends BoxelSpec {}

export class AppListing extends Listing {
  static displayName = 'App Listing';
  static isolated = Isolated;
  //overrides
  @field doYouWantToTrackQuantity = contains(BooleanField, {
    computeVia: function (this) {
      return false; // this as computed makes this non-editable
    },
  });
  @field spec = linksTo(AppBoxelSpec);

  // most likely, no other delegated render to fitted unless its an image
  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <@fields.name />
      <@fields.publisher format='atom' />
    </template>
  };
}
