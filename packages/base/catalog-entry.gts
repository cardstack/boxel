import {
  contains,
  field,
  Component,
  Card,
  CardBase,
  primitive,
  relativeTo,
  realmInfo,
} from './card-api';
import StringCard from './string';
import BooleanCard from './boolean';
import CardRefCard from './card-ref';
import { baseCardRef, loadCard } from '@cardstack/runtime-common';
import { isEqual } from 'lodash';
import { FieldContainer } from '@cardstack/boxel-ui';

export class CatalogEntry extends Card {
  static displayName = 'Catalog Entry';
  @field title = contains(StringCard);
  @field description = contains(StringCard);
  @field ref = contains(CardRefCard);
  @field isPrimitive = contains(BooleanCard, {
    computeVia: async function (this: CatalogEntry) {
      let card: typeof CardBase | undefined = await loadCard(this.ref, {
        relativeTo: this[relativeTo],
      });
      if (!card) {
        throw new Error(`Could not load card '${this.ref.name}'`);
      }
      // the base card is a special case where it is technically not a primitive, but because it has no fields
      // it is not useful to treat as a composite card (for the purposes of creating new card instances).
      return primitive in card || isEqual(baseCardRef, this.ref);
    },
  });
  @field moduleHref = contains(StringCard, {
    computeVia: function (this: CatalogEntry) {
      return new URL(this.ref.module, this[relativeTo]).href;
    },
  });
  @field demo = contains(Card);
  @field realmName = contains(StringCard, {
    computeVia: function (this: CatalogEntry) {
      return this[realmInfo]?.name;
    },
  });

  get showDemo() {
    return !this.isPrimitive;
  }

  // An explicit edit template is provided since computed isPrimitive bool
  // field (which renders in the embedded format) looks a little wonky
  // right now in the edit view.
  static edit = class Edit extends Component<typeof this> {
    <template>
      <div class='catalog-entry catalog-entry--edit'>
        <FieldContainer @tag='label' @label='Title' data-test-field='title'>
          <@fields.title />
        </FieldContainer>
        <FieldContainer
          @tag='label'
          @label='Description'
          data-test-field='description'
        >
          <@fields.description />
        </FieldContainer>
        <FieldContainer @label='Ref' data-test-field='ref'>
          <@fields.ref />
        </FieldContainer>
        <FieldContainer @label='Realm Name' data-test-field='realmName'>
          <@fields.realmName />
        </FieldContainer>
        <FieldContainer @vertical={{true}} @label='Demo' data-test-field='demo'>
          <@fields.demo />
        </FieldContainer>
      </div>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='catalog-entry catalog-entry--embedded'>
        <header class='catalog-entry--embedded__title'>
          <@fields.title />
        </header>
        <p class='catalog-entry-embedded__description' data-test-description>
          <@fields.description />
        </p>
      </div>
    </template>
  };

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='catalog-entry'>
        <h1 data-test-title><@fields.title /></h1>
        <em data-test-description><@fields.description /></em>
        <div data-test-ref>
          Module:
          <@fields.moduleHref />
          Name:
          {{@model.ref.name}}
        </div>
        <div class='catalog-entry__realm-name' data-test-realm-name>
          in
          <@fields.realmName />
        </div>
        {{#if @model.showDemo}}
          <div data-test-demo><@fields.demo /></div>
        {{/if}}
      </div>
    </template>
  };
}
