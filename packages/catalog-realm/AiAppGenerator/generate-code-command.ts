import {
  CardDef,
  field,
  linksTo,
  contains,
} from 'https://cardstack.com/base/card-api';
import { Command } from '@cardstack/runtime-common';
import { SkillCard } from 'https://cardstack.com/base/skill-card';
import StringField from 'https://cardstack.com/base/string';
import { ProductRequirementDocument } from '../product-requirement-document';
import AddSkillsToRoomCommand from '@cardstack/boxel-host/commands/add-skills-to-room';
import SendAiAssistantMessageCommand from '@cardstack/boxel-host/commands/send-ai-assistant-message';

export class GenerateCodeInput extends CardDef {
  @field productRequirements = linksTo(() => ProductRequirementDocument);
  @field roomId = contains(StringField);
}

export class ConstructApplicationCodeInput extends CardDef {
  @field title = contains(StringField, {
    computeVia: function (this: ConstructApplicationCodeInput) {
      return this.appName;
    },
  });
  @field description = contains(StringField, {
    computeVia: function (this: ConstructApplicationCodeInput) {
      return '';
    },
  });
  @field thumbnailURL = contains(StringField, {
    computeVia: function (this: ConstructApplicationCodeInput) {
      return '';
    },
  });
  @field code = contains(StringField, {
    description: 'The CardDef and FieldDef classes, this is required',
  });
  @field appName = contains(StringField, {
    description:
      'The name of the application, as a class name. Must be a valid class name.',
  });
}

class ConstructApplicationCodeCommand extends Command<
  ConstructApplicationCodeInput,
  ConstructApplicationCodeInput
> {
  public result: ConstructApplicationCodeInput =
    new ConstructApplicationCodeInput();
  async getInputType(): Promise<
    new (args: any) => ConstructApplicationCodeInput
  > {
    console.log('Getting input type NEW', ConstructApplicationCodeInput);
    return ConstructApplicationCodeInput;
  }

  protected async run(
    input: ConstructApplicationCodeInput,
  ): Promise<ConstructApplicationCodeInput> {
    return new ConstructApplicationCodeInput({
      code: constructModule(input),
      appName: input.appName,
    });
  }
}

function constructModule(input: ConstructApplicationCodeInput) {
  const imports = `
  import BooleanField from 'https://cardstack.com/base/boolean';
  import NumberField from 'https://cardstack.com/base/number';
  import MarkdownField from 'https://cardstack.com/base/markdown';
  import DateField from 'https://cardstack.com/base/date';
  import DateTimeField from 'https://cardstack.com/base/datetime';
  import TextAreaField from 'https://cardstack.com/base/text-area';
import CodeRefField from 'https://cardstack.com/base/code-ref';
import { Base64ImageField } from 'https://cardstack.com/base/base64-image';
import { AppCard } from '/catalog/app-card';
import {
  CardDef,
  field,
  contains,
  containsMany,
  linksTo,
  linksToMany,
  FieldDef,
  Component,
  realmURL,
  StringField,
} from 'https://cardstack.com/base/card-api';
import { CardContainer } from '@cardstack/boxel-ui/components';
import { and, bool, cn } from '@cardstack/boxel-ui/helpers';
import { baseRealm, getCard } from '@cardstack/runtime-common';
import { hash } from '@ember/helper';
import { on } from '@ember/modifier';
import AddSkillsToRoomCommand from '@cardstack/boxel-host/commands/add-skills-to-room';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { restartableTask } from 'ember-concurrency';
  `;

  return `${imports}

  ${input.code}


  export class ${input.appName} extends AppCard {
    static displayName = '${input.appName}';
  }
  `;
}

export default class GenerateCodeCommand extends Command<
  GenerateCodeInput,
  ConstructApplicationCodeInput
> {
  async getInputType(): Promise<new (args: any) => GenerateCodeInput> {
    return GenerateCodeInput;
  }

  get skillCard() {
    return new SkillCard({
      id: 'CodeGeneratorHelper',
      title: 'Code Generator',
      description:
        'This skill card can be used to help with creating field and card definitions for a boxel app',
      instructions: `The user has shared with you a product requirement document for an application they want to build. You must build that. Look at the domain for the area they are interested in and use your general knowledge to ensure data structures and the linkages between them are created.

      You are a software engineer specializing in Boxel development. Boxel is a platform where people can create Cards, which under the hood are built out of glimmer components and ember. You are designed to assist users with code-related queries, troubleshooting, and best practices in this specific domain. You should ask for clarification when the user's query is ambiguous or lacks detail, but should also be able to make reasonable assumptions based on typical software engineering practices.

      If the user wants to make something, they mostly want to create a Card. Cards are independent linkable items that get an ID. Fields are contained within cards, so sometimes a user wants a custom field (derived from FieldDef), but usually it's creating a card (derived from CardDef).

      Use typescript for the code. Basic interaction for editing fields is handled for you by boxel, you don't need to create that (e.g. StringField has an edit template that allows a user to edit the data). Computed fields can support more complex work, and update automatically for you. Interaction (button clicks, filtering on user typed content) will require work on templates that will happen elsewhere and is not yours to do.

      Never leave sections of code unfilled or with placeholders, finish all code you write.

      Put all classes in the same codeblock/file, and have all CardDefs exported (e.g. export class MyCard extends CardDef)


      You have available:

      StringField
      MarkdownField
      NumberField
      BooleanField
      DateField
      DateTimeField

      Construct any more complex data structures from these

      Fields do not have default values.

      Use the () => format for linking between cards


The following imports are provided automatically for you, **DO NOT INCLUDE THEM IN YOUR CODE**:

\`\`\`gts
import BooleanField from 'https://cardstack.com/base/boolean';
import NumberField from 'https://cardstack.com/base/number';
import MarkdownField from 'https://cardstack.com/base/markdown';
import DateField from 'https://cardstack.com/base/date';
import DateTimeField from 'https://cardstack.com/base/date-time';
import TextAreaField from 'https://cardstack.com/base/text-area';
import { Base64ImageField } from 'https://cardstack.com/base/base64-image';
import {
CardDef,
field,
contains,
containsMany,
linksTo,
linksToMany,
FieldDef,
Component,
StringField,
} from 'https://cardstack.com/base/card-api';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { fn, get } from '@ember/helper';
import { on } from '@ember/modifier';
\`\`\`

      \`\`\`gts

      class MyCustomField extends FieldDef {
          @field nestedField = contains(NumberField);
          @field nestedOtherField = contains(BooleanField);

      }

      export class OutOfOrderDeclaration extends CardDef {
            static displayName = 'OutOfOrderDeclaration';

            @field linkToCardDefinedLaterInFile = linksTo(() => MyCustomCard);

      }

      export class MyCustomCard  extends CardDef {
          static displayName = 'BoxelBuddyGuestList';

          @field structuredData = contains(MyCustomField);

          // linksTo and linksToMany
          @field linkedData = linksToMany(() => AnotherCard);

          // A field that is computed from other data in the card
         @field computedData = contains(NumberField, {
           computeVia: function (this: MyCustomCard) {
             // implementation logic here
             return 1;
           },
         });

        export class InOrderDeclaration extends CardDef {
            static displayName = 'InOrderDeclaration';

            @field linkToCardDefinedLaterInFile = linksTo( () => MyCustomCard);
        }

        }
        \`\`\`

        Important:

        If a user is asking  you to make, help or create something, assume they mean a boxel card or application.


        Remember to define a field the following syntax is used:

          @field fieldname = contains(FieldType);
          @field fieldname = containsMany(FieldType);

        And for linking to other cards:

          @field fieldname = linksTo(() => CardType);
          @field fieldname = linksToMany(() => CardType);

        You can propose new/improved data structures.

        Talk through the problem and structures, specifying how each should link to each other (this is very important), then write the code.

        YOU MUST CONSIDER LINKS BETWEEN THESE TYPES. Make sure common entities are extracted as their own types and that linksTo or linksToMany are used to connect the cards that need to be connected.

        Remember, if in the code a card class is used before it is defined, you must use the () => syntax. All CardDef classes should be exported classes.

        Never ask the user for followups, you must call the ConstructApplicationCodeCommand to continue.
      `,
    });
  }

  protected async run(
    input: GenerateCodeInput,
  ): Promise<ConstructApplicationCodeInput> {
    console.log('Input into the run', input);
    let constructApplicationCodeCommand = new ConstructApplicationCodeCommand(
      this.commandContext,
    );
    let addSkillsToRoomCommand = new AddSkillsToRoomCommand(
      this.commandContext,
    );
    await addSkillsToRoomCommand.execute({
      roomId: input.roomId,
      skills: [this.skillCard],
    });
    let sendAiAssistantMessageCommand = new SendAiAssistantMessageCommand(
      this.commandContext,
    );
    await sendAiAssistantMessageCommand.execute({
      roomId: input.roomId,
      prompt:
        'Generate code for the application given the product requirements, you do not need to strictly follow the schema if it does not seem appropriate for the application.',
      attachedCards: [input.productRequirements],
      commands: [
        { command: constructApplicationCodeCommand, autoExecute: true },
      ],
    });

    return await constructApplicationCodeCommand.waitForNextCompletion();
  }
}
