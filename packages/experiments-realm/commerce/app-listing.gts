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
import { Pill } from '@cardstack/boxel-ui/components';
import { BoxelIcon } from '@cardstack/boxel-ui/icons';
// @ts-ignore no types
import cssUrl from 'ember-css-url';

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
      .app-icon img {
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
        <div>
          <img
            style={{cssUrl 'background-image' @model.thumbnailURL}}
            class='app-icon'
          />
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

class Fitted extends Component<typeof AppListing> {
  get publisher() {
    return (
      this.args.model.publisher?.firstName +
        ' ' +
        this.args.model.publisher?.lastName || ''
    );
  }

  <template>
    <div class='card-list'>
      <div class='card-list-content'>
        <Pill @kind='default' class='custom-pill'>
          <:icon>
            <BoxelIcon width='11px' height='11px' />
          </:icon>
          <:default>
            500
          </:default>
        </Pill>

        <div class='app-icon'>
          <img src={{cssUrl @model.thumbnailURL}} />
        </div>

        <div class='app-info'>
          <div class='app-name'><@fields.name /></div>
          <div class='app-publisher'>Publisher: {{this.publisher}}</div>
        </div>
      </div>
    </div>
    <style scoped>
      .card-list {
        --boxel-app-icon-size: clamp(
          30px,
          calc(40px + 0.3cqw),
          calc(50px + 0.5cqw)
        );
        --boxel-app-name-size: clamp(
          14px,
          calc(14px + 0.3cqw),
          calc(40px + 0.3cqw)
        );
        --boxel-app-publisher-size: clamp(
          12px,
          calc(12px + 0.1cqw),
          calc(12px + 0.2cqw)
        );
        width: 100%;
        height: 100%;
        overflow: hidden;
      }
      .card-list-content {
        width: 100%;
        height: 100%;
        position: relative;
        display: flex;
        align-items: center;
        justify-content: start;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp-xs);
      }
      .app-icon {
        width: 100%;
        max-width: var(--boxel-app-icon-size);
        aspect-ratio: 1 / 1;
        border-radius: var(--boxel-border-radius-sm);
      }
      .app-icon img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 8px;
      }
      .app-name {
        margin: 0;
        font-size: var(--boxel-app-name-size);
        font-weight: bold;
        color: var(--boxel-dark);
        text-overflow: ellipsis;
        line-height: var(--boxel-app-name-size);
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        word-break: break-word;
        overflow: hidden;
      }
      .app-publisher {
        font-size: var(--boxel-app-publisher-size);
        line-height: var(--boxel-app-publisher-size);
        color: var(--boxel-500);
      }
      .custom-pill {
        --pill-font-color: var(--boxel-light);
        --pill-background-color: var(--boxel-blue);
        --pill-padding: var(--boxel-sp-5xs) var(--boxel-sp-xxs);
        --pill-gap: var(--boxel-sp-xxs);
        --pill-icon-size: var(--boxel-icon-xs);
        font-size: var(--boxel-font-size-xs);
        position: absolute;
        top: 0;
        right: 0;
        margin: var(--boxel-sp-4xs);
      }
      .custom-pill svg {
        --icon-color: var(--boxel-light);
      }

      @container (aspect-ratio <= 1.0) {
        .card-list-content {
          flex-direction: column;
          text-align: center;
          justify-content: center;
        }
      }

      @container (height < 115px) {
        .custom-pill,
        .app-publisher {
          display: none;
        }
      }

      @container (aspect-ratio > 2.5) {
        .card-list-content {
          flex-direction: row;
          align-items: center;
        }
      }
    </style>
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
  static fitted = Fitted;
}
