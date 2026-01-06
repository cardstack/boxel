import { on } from '@ember/modifier';

import CreateAiAssistantRoomCommand from '@cardstack/boxel-host/commands/create-ai-assistant-room';
import SendAiAssistantMessageCommand from '@cardstack/boxel-host/commands/send-ai-assistant-message';
// import SwitchSubmodeCommand from '@cardstack/boxel-host/commands/switch-submode';

import {
  contains,
  field,
  Component,
  CardDef,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import StringField from 'https://cardstack.com/base/string';

export class Person extends CardDef {
  @field firstName = contains(StringField);
  @field lastName = contains(StringField);
  @field email = contains(StringField);
  @field posts = contains(NumberField);
  @field fullName = contains(StringField, {
    computeVia: function (this: Person) {
      return `${this.firstName ?? ''} ${this.lastName ?? ''}`;
    },
  });
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Person) {
      return `${this.firstName ?? ''} ${this.lastName ?? ''}`;
    },
  });
  @field cardDescription = contains(StringField, { computeVia: () => 'Person' });

  static isolated = class Isolated extends Component<typeof this> {
    runSwitchToCodeModeCommandViaAiAssistant = async () => {
      let commandContext = this.args.context?.commandContext;
      if (!commandContext) {
        console.error('No command context found');
        return;
      }
      let createAIAssistantRoomCommand = new CreateAiAssistantRoomCommand(
        commandContext,
      );
      let { roomId } = await createAIAssistantRoomCommand.execute({
        name: 'AI Assistant Room',
      });
      let sendAiAssistantMessageCommand = new SendAiAssistantMessageCommand(
        commandContext,
      );
      await sendAiAssistantMessageCommand.execute({
        roomId,
        prompt: 'Switch to code mode',
      });
    };
    <template>
      <h1><@fields.firstName /></h1>
      <h1><@fields.cardTitle /></h1>
      <button
        {{on 'click' this.runSwitchToCodeModeCommandViaAiAssistant}}
        data-test-switch-to-code-mode-button
      >Switch to code-mode</button>
    </template>
  };
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <h3>Person: <@fields.firstName /></h3>
      <h1><@fields.cardTitle /></h1>
    </template>
  };
  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <h3>Person: <@fields.firstName /></h3>
      <h1><@fields.cardTitle /></h1>
    </template>
  };
}

export class PersonField extends FieldDef {
  @field firstName = contains(StringField);
  @field lastName = contains(StringField);
  @field email = contains(StringField);
  @field posts = contains(NumberField);
  @field fullName = contains(StringField, {
    computeVia: function (this: Person) {
      return `${this.firstName ?? ''} ${this.lastName ?? ''}`;
    },
  });
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Person) {
      return `${this.firstName ?? ''} ${this.lastName ?? ''}`;
    },
  });
  @field cardDescription = contains(StringField, { computeVia: () => 'Person' });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <h1><@fields.firstName /></h1>
      <h1><@fields.cardTitle /></h1>
    </template>
  };
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <h3>Person: <@fields.firstName /></h3>
      <h1><@fields.cardTitle /></h1>
    </template>
  };
}
