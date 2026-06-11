import {
  CardDef,
  FieldDef,
  Component,
  field,
  contains,
  containsMany,
  StringField,
} from 'https://cardstack.com/base/card-api';
import { BoxelContainer } from '@cardstack/boxel-ui/components';

class FamilyMember extends FieldDef {
  static displayName = 'Family Member';
  @field firstName = contains(StringField);
  @field lastName = contains(StringField);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <span class='first-name'><@fields.firstName /></span>
      <span class='last-name'><@fields.lastName /></span>
    </template>
  };
  static fitted = this.embedded;
}

export class Family extends CardDef {
  static displayName = 'Family';
  @field people = containsMany(FamilyMember);
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <BoxelContainer>
        <h3>Family (no chrome `containsMany`):</h3>
        <div class='family'>
          <@fields.people @displayContainer={{false}} />
        </div>
      </BoxelContainer>
      <BoxelContainer>
        <h3>Family (default `containsMany`):</h3>
        <div class='family'>
          <@fields.people />
        </div>
      </BoxelContainer>
      <hr />
      <BoxelContainer>
        <h3>Family List</h3>
        <ul class='family-list'>
          {{#each @fields.people as |FamilyMember|}}
            <li>
              <FamilyMember @displayContainer={{false}} />
            </li>
          {{/each}}
        </ul>
      </BoxelContainer>
      <hr />
    </template>
  };
}
