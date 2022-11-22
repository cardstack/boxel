import { contains, field, Component, Card, primitive } from './card-api';
import StringCard from './string';
import BooleanCard from './boolean';
import CardRefCard from './card-ref';
import { baseCardRef, loadCard } from "@cardstack/runtime-common";
import { initStyleSheet, attachStyles } from './attach-styles';
import { isEqual } from 'lodash';

let css = `
  this {
    background-color: #cbf3f0;
    border: 1px solid gray;
    border-radius: 10px;
    padding: 1rem;
  }
  .demo {
    margin-top: 1rem;
  }
`;

let editCSS = `
  this {
    background-color: #cbf3f0;
    border: 1px solid gray;
    border-radius: 10px;
    padding: 1rem;
  }
  .edit-field {
    display: block;
    padding: 0.75rem;
    text-transform: capitalize;
    background-color: #ffffff6e;
    border: 1px solid gray;
    margin: 0.5rem 0;
  }
  input[type=text] {
    box-sizing: border-box;
    background-color: transparent;
    width: 100%;
    margin-top: .5rem;
    display: block;
    padding: 0.5rem;
    font: inherit;
    border: inherit;
  }
`;

let styles = initStyleSheet(css);
let editStyles = initStyleSheet(editCSS);

export class CatalogEntry extends Card {
  @field title = contains(StringCard);
  @field description = contains(StringCard);
  @field ref = contains(CardRefCard);
  @field isPrimitive = contains(BooleanCard, { computeVia: async function(this: CatalogEntry) {
    let card: typeof Card | undefined = await loadCard(this.ref);
    if (!card) {
      throw new Error(`Could not load card ${JSON.stringify(this.ref, null, 2)}`);
    }
    return primitive in card ||
      // the base card is a special case where it is technically not a primitive, but because it has no fields
      // it is not useful to treat as a composite card (for the purposes of creating new card instances).
      isEqual(baseCardRef, this.ref);
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
      <div {{attachStyles editStyles}}>
        <label class="edit-field" data-test-field="title">Title
          <@fields.title/>
        </label>
        <label class="edit-field" data-test-field="description">Description
          <@fields.description/>
        </label>
        <div class="edit-field" data-test-field="ref">Ref
          <@fields.ref/>
        </div>
        <div class="edit-field" data-test-field="demo">Demo
          <@fields.demo/>
        </div>
      </div>
    </template>
  }

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div {{attachStyles styles}}>
        <h2><@fields.title/></h2>
        <div><@fields.ref/></div>
        {{#if @model.showDemo}}
          <div class="demo" data-test-demo-embedded><@fields.demo/></div>
        {{/if}}
      </div>
    </template>
  }

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div {{attachStyles styles}}>
        <h1 data-test-title><@fields.title/></h1>
        <p data-test-description><em><@fields.description/></em></p>
        <div><@fields.ref/></div>
        {{#if @model.showDemo}}
          <div class="demo" data-test-demo><@fields.demo/></div>
        {{/if}}
      </div>
    </template>
  }
}
