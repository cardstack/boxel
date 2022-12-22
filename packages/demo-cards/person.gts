import { contains, linksTo, field, Component, Card } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import BooleanCard from 'https://cardstack.com/base/boolean';
import { CardContainer } from '@cardstack/boxel-ui';
import { initStyleSheet, attachStyles } from '@cardstack/boxel-ui/attach-styles';
import { Pet } from './pet';

let styles = initStyleSheet(`
  this {
    min-width: 20rem;
    padding: var(--boxel-sp);
    display: grid;
    gap: var(--boxel-sp);
  }
`);

export class Person extends Card {
  @field firstName = contains(StringCard);
  @field lastName = contains(StringCard);
  @field isCool = contains(BooleanCard);
  @field isHuman = contains(BooleanCard);
  @field pet = linksTo(Pet);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer @displayBoundaries={{true}} {{attachStyles styles}}>
        <h3><@fields.firstName/> <@fields.lastName/></h3>
        {{#if @model.pet}}<div><@fields.pet/></div>{{/if}}
      </CardContainer>
    </template>
  }

  static isolated = class Isolated extends Component<typeof Person> {
    <template>
      <CardContainer @displayBoundaries={{true}} {{attachStyles styles}}>
        <h2><@fields.firstName/> <@fields.lastName /></h2>
        <div>
          <div><@fields.isCool/></div>
          <div><@fields.isHuman/></div>
        </div>
        {{#if @model.pet}}<@fields.pet/>{{/if}}
      </CardContainer>
    </template>
  }
}
