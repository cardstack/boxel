import { contains, field, Component, Card, primitive } from './card-api';
import StringCard from './string';
import BooleanCard from './boolean';
import CardRefCard from './card-ref';
import { baseCardRef, loadCard } from "@cardstack/runtime-common";
import { isEqual } from 'lodash';
import { CardContainer, FieldContainer } from '@cardstack/boxel-ui';
import { initStyleSheet, attachStyles } from '@cardstack/boxel-ui/attach-styles';

let styles = initStyleSheet(`
  this {
    padding: var(--boxel-sp);
  }
  .demo {
    margin-top: var(--boxel-sp);
  }
`);

export class CatalogEntry extends Card {
  @field title = contains(StringCard);
  @field description = contains(StringCard);
  @field ref = contains(CardRefCard);
  @field isPrimitive = contains(BooleanCard, { computeVia: async function(this: CatalogEntry) {
    let card: typeof Card | undefined = await loadCard(this.ref);
    if (!card) {
      throw new Error(`Could not load card '${this.ref.name}'`);
    }
    // the base card is a special case where it is technically not a primitive, but because it has no fields
    // it is not useful to treat as a composite card (for the purposes of creating new card instances).
    return primitive in card || isEqual(baseCardRef, this.ref);
  }});
  @field demo = contains(Card);

  get showDemo() {
    return !this.isPrimitive;
  }

  // An explicit edit template is provided since computed isPrimitive bool
  // field (which renders in the embedded format) looks a little wonky
  // right now in the edit view.
  static edit = class Edit extends Component<typeof this> {
    <template>
      <CardContainer @displayBoundaries={{true}} {{attachStyles styles}}>
        <FieldContainer @tag="label" @label="Title" @horizontal={{true}} data-test-field="title">
          <@fields.title/>
        </FieldContainer>
        <FieldContainer @tag="label" @label="Description" @horizontal={{true}} data-test-field="description">
          <@fields.description/>
        </FieldContainer>
        <FieldContainer @label="Ref" @horizontal={{true}} data-test-field="ref">
          <@fields.ref/>
        </FieldContainer>
        <FieldContainer @vertical={{true}} @label="Demo" data-test-field="demo">
          <@fields.demo/>
        </FieldContainer>
      </CardContainer>
    </template>
  }

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer @displayBoundaries={{true}} {{attachStyles styles}}>
        <h2><@fields.title/></h2>
        <div><@fields.ref/></div>
        {{#if @model.showDemo}}
          <div class="demo" data-test-demo-embedded><@fields.demo/></div>
        {{/if}}
      </CardContainer>
    </template>
  }

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <CardContainer @displayBoundaries={{true}} {{attachStyles styles}}>
        <h1 data-test-title><@fields.title/></h1>
        <p data-test-description><em><@fields.description/></em></p>
        <div><@fields.ref/></div>
        {{#if @model.showDemo}}
          <div class="demo" data-test-demo><@fields.demo/></div>
        {{/if}}
      </CardContainer>
    </template>
  }
}
