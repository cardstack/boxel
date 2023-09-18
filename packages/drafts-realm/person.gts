import {
  contains,
  linksTo,
  field,
  Component,
  CardDef,
} from 'https://cardstack.com/base/card-api';
import BooleanCard from 'https://cardstack.com/base/boolean';
import StringCard from 'https://cardstack.com/base/string';
import { Pet } from './pet';
import { GridContainer } from '@cardstack/boxel-ui';
import { Address } from './address';

export class Person extends CardDef {
  static displayName = 'Person';
  @field firstName = contains(StringCard);
  @field lastName = contains(StringCard);
  @field isCool = contains(BooleanCard);
  @field isHuman = contains(BooleanCard);
  @field address = contains(Address);
  @field pet = linksTo(Pet);
  @field title = contains(StringCard, {
    computeVia: function (this: Person) {
      return [this.firstName, this.lastName].filter(Boolean).join(' ');
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <GridContainer>
        <h3><@fields.firstName /> <@fields.lastName /></h3>
        {{#if @model.pet}}<div><@fields.pet /></div>{{/if}}
      </GridContainer>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Person> {
    <template>
      <GridContainer>
        <h2><@fields.title /></h2>
        <div>
          <div>Is Cool: <@fields.isCool /></div>
          <div>Is Human: <@fields.isHuman /></div>
        </div>
        {{#if @model.pet}}<@fields.pet />{{/if}}
      </GridContainer>
    </template>
  };
}
