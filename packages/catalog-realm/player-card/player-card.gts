import {
  CardDef,
  contains,
  field,
  linksTo,
  FieldDef,
  Component,
  primitive,
} from 'https://cardstack.com/base/card-api';
import { AvatarCreator } from '../avatar-creator/avatar-creator';
import { RadioInput } from '@cardstack/boxel-ui/components';
import { fn } from '@ember/helper';
import { not } from '@cardstack/boxel-ui/helpers';

export class PlayerTypeField extends FieldDef {
  static displayName = 'Player Type';
  static [primitive]: 'human' | 'bot';

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{@model}}
    </template>
  };

  static edit = class Edit extends Component<typeof this> {
    <template>
      <div data-test-radio-group={{@fieldName}}>
        <RadioInput
          @items={{this.items}}
          @groupDescription='Select type'
          @checkedId={{this.checkedId}}
          @disabled={{not @canEdit}}
          as |item|
        >
          <item.component @onChange={{fn @set item.data.value}}>
            {{item.data.text}}
          </item.component>
        </RadioInput>
      </div>
    </template>

    private items = [
      { id: 'human', value: 'human', text: 'Human' },
      { id: 'bot', value: 'bot', text: 'Bot' },
    ];

    get checkedId() {
      return String(this.args.model);
    }
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      {{@model}}
    </template>
  };
}

export class PlayerCard extends CardDef {
  static displayName = 'Player Card';

  @field player = linksTo(() => AvatarCreator);
  @field type = contains(PlayerTypeField);
}
