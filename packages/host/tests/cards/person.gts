import { on } from '@ember/modifier';
import {
  contains,
  field,
  Component,
  CardDef,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import { SwitchSubmodeInput } from 'https://cardstack.com/base/command';
import NumberCard from 'https://cardstack.com/base/number';
import StringCard from 'https://cardstack.com/base/string';

export class Person extends CardDef {
  @field firstName = contains(StringCard);
  @field lastName = contains(StringCard);
  @field email = contains(StringCard);
  @field posts = contains(NumberCard);
  @field fullName = contains(StringCard, {
    computeVia: function (this: Person) {
      return `${this.firstName ?? ''} ${this.lastName ?? ''}`;
    },
  });
  @field title = contains(StringCard, {
    computeVia: function (this: Person) {
      return `${this.firstName ?? ''} ${this.lastName ?? ''}`;
    },
  });
  @field description = contains(StringCard, { computeVia: () => 'Person' });

  static isolated = class Isolated extends Component<typeof this> {
    runSwitchToCodeModeCommandViaAiAssistant = () => {
      let commandContext = this.args.context?.commandContext;
      if (!commandContext) {
        console.error('No command context found');
        return;
      }
      let switchSubmodeCommand = commandContext.lookupCommand<
        SwitchSubmodeInput,
        undefined
      >('switch-submode');
      commandContext.sendAiAssistantMessage({
        prompt: 'Switch to code mode',
        commands: [{ command: switchSubmodeCommand, autoExecute: true }],
      });
    };
    <template>
      <h1><@fields.firstName /></h1>
      <h1><@fields.title /></h1>
      <button
        {{on 'click' this.runSwitchToCodeModeCommandViaAiAssistant}}
        data-test-switch-to-code-mode-button
      >Switch to code-mode</button>
    </template>
  };
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <h3>Person: <@fields.firstName /></h3>
      <h1><@fields.title /></h1>
    </template>
  };
  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <h3>Person: <@fields.firstName /></h3>
      <h1><@fields.title /></h1>
    </template>
  };
}

export class PersonField extends FieldDef {
  @field firstName = contains(StringCard);
  @field lastName = contains(StringCard);
  @field email = contains(StringCard);
  @field posts = contains(NumberCard);
  @field fullName = contains(StringCard, {
    computeVia: function (this: Person) {
      return `${this.firstName ?? ''} ${this.lastName ?? ''}`;
    },
  });
  @field title = contains(StringCard, {
    computeVia: function (this: Person) {
      return `${this.firstName ?? ''} ${this.lastName ?? ''}`;
    },
  });
  @field description = contains(StringCard, { computeVia: () => 'Person' });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <h1><@fields.firstName /></h1>
      <h1><@fields.title /></h1>
    </template>
  };
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <h3>Person: <@fields.firstName /></h3>
      <h1><@fields.title /></h1>
    </template>
  };
}
