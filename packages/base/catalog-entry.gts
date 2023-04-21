import {
  contains,
  field,
  Component,
  Card,
  primitive,
  relativeTo,
} from './card-api';
import StringCard from './string';
import BooleanCard from './boolean';
import CardRefCard from './card-ref';
import { baseCardRef, loadCard } from '@cardstack/runtime-common';
import { isEqual } from 'lodash';
import { CardContainer, FieldContainer } from '@cardstack/boxel-ui';

export class CatalogEntry extends Card {
  @field title = contains(StringCard);
  @field description = contains(StringCard);
  @field ref = contains(CardRefCard);
  @field isPrimitive = contains(BooleanCard, {
    computeVia: async function (this: CatalogEntry) {
      let card: typeof Card | undefined = await loadCard(this.ref, {
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

  get showDemo() {
    return !this.isPrimitive;
  }

  // An explicit edit template is provided since computed isPrimitive bool
  // field (which renders in the embedded format) looks a little wonky
  // right now in the edit view.
  static edit = class Edit extends Component<typeof this> {
    <template>
      <CardContainer
        class='catalog-entry catalog-entry--edit'
        @displayBoundaries={{true}}
      >
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
        <FieldContainer @vertical={{true}} @label='Demo' data-test-field='demo'>
          <@fields.demo />
        </FieldContainer>
      </CardContainer>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer class='catalog-entry' @displayBoundaries={{true}}>
        <header><@fields.title /></header>
        <div class='catalog-entry__ref' data-test-ref>
          <@fields.moduleHref />
        </div>
      </CardContainer>
    </template>
  };

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <CardContainer class='catalog-entry' @displayBoundaries={{true}}>
        <h1 data-test-title><@fields.title /></h1>
        <em data-test-description><@fields.description /></em>
        <div data-test-ref>
          Module:
          <@fields.moduleHref />
          Name:
          {{@model.ref.name}}
        </div>
        {{#if @model.showDemo}}
          <div data-test-demo><@fields.demo /></div>
        {{/if}}
      </CardContainer>
    </template>
  };
}
