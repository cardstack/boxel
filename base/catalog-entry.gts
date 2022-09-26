import { contains, field, Component, Card, primitive } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import BooleanCard from 'https://cardstack.com/base/boolean';
import CardRefCard from 'https://cardstack.com/base/card-ref';
import { Loader, baseCardRef } from "@cardstack/runtime-common";

export class CatalogEntry extends Card {
  @field title = contains(StringCard);
  @field description = contains(StringCard);
  @field ref = contains(CardRefCard);
  @field isPrimitive = contains(BooleanCard, { computeVia: async function(this: CatalogEntry) {
    // TODO this manner of getting the correct loader works specifically inside a card's class scope.
    // It would be great, tho, to generalize this so that it works anywhere in this module's scope.
    let module: Record<string, any> = await Loader.getLoaderFor(this.constructor).import(this.ref.module);
    let Clazz: typeof Card = module[this.ref.name];
    return primitive in Clazz ||
      // the base card is a special case where it is technically not a primitive, but because it has no fields
      // it is not useful to treat as a composite card (for the purposes of creating new card instances).
      (baseCardRef.module === this.ref.module && baseCardRef.name === this.ref.name);
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
      <div class="card-edit">
        <label data-test-field="title">Title
          <@fields.title/>
        </label>
        <label data-test-field="description">Description
          <@fields.description/>
        </label>
        <div data-test-field="ref">Ref
          <@fields.ref/>
        </div>
        <div data-test-field="demo">Demo
          <@fields.demo/>
        </div>
      </div>
    </template>
  }

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <h3><@fields.title/></h3>
      <p><em><@fields.description/></em></p>
      <div><@fields.ref/></div>
      {{#if @model.showDemo}}
        <div class="card" data-test-demo-embedded><@fields.demo/></div>
      {{/if}}
    </template>
  }
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <h1 data-test-title><@fields.title/></h1>
      <p data-test-description><em><@fields.description/></em></p>
      <div><@fields.ref/></div>
      {{#if @model.showDemo}}
        <div class="card" data-test-demo><@fields.demo/></div>
      {{/if}}
    </template>
  }
}