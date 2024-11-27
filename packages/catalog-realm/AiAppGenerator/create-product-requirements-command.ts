import { Command } from '@cardstack/runtime-common';
import {
  CardDef,
  StringField,
  contains,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import { ProductRequirementDocument } from '../product-requirement-document';
import { SkillCard } from 'https://cardstack.com/base/skill-card';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import PatchCardCommand from '@cardstack/boxel-host/commands/patch-card';
import ReloadCardCommand from '@cardstack/boxel-host/commands/reload-card';

export class CreateProductRequirementsInput extends CardDef {
  @field targetAudience = contains(StringField);
  @field productDescription = contains(StringField);
  @field features = contains(StringField);
  @field realm = contains(StringField);
}

class CreateProductRequirementsResult extends CardDef {
  @field productRequirements = linksTo(ProductRequirementDocument);
  @field roomId = contains(StringField);
}

export default class CreateProductRequirementsInstance extends Command<
  CreateProductRequirementsInput,
  CreateProductRequirementsResult
> {
  inputType = CreateProductRequirementsInput;

  get skillCard() {
    return new SkillCard({
      id: 'SkillCard1',
      name: 'PRD Helper',
      description:
        'This skill card can be used to help with creating product requirements',
      instructions:
        'Given a prompt, fill in the product requirements document. Update the appTitle. Update the prompt to be grammatically accurate. Description should be 1 or 2 short sentences. In overview, provide 1 or 2 paragraph summary. In schema, make a list of the schema for the app. In Layout & Navigation, provide brief information for the layout and navigation of the app. NEVER offer to update the card, you MUST call patchCard in your response.',
    });
  }

  createPrompt(input: CreateProductRequirementsInput) {
    return `Create product requirements for ${input.targetAudience} with the following description: ${input.productDescription}. Focus on the following features: ${input.features}`;
  }

  protected async run(
    input: CreateProductRequirementsInput,
  ): Promise<CreateProductRequirementsResult> {
    console.log('Input into the run', input);
    // Create new card
    let prdCard = new ProductRequirementDocument();
    console.log('prdCard', prdCard);

    let saveCardCommand = new SaveCardCommand(this.commandContext);
    let SaveCardInputType = await saveCardCommand.getInputType();
    await saveCardCommand.execute(
      new SaveCardInputType({
        realm: input.realm,
        card: prdCard,
      }),
    );
    console.log('prdCard after save', prdCard);

    // Get patch command, this takes the card and returns a command that can be used to patch the card
    let patchPRDCommand = new PatchCardCommand(this.commandContext, {
      cardType: ProductRequirementDocument,
    });

    // This should return a session ID so that we can potentially send followup messages
    // This should delegate to a matrix service method. Besides actually sending the message,
    // with attached cards, skill cards, and commands, it should also be responsible for assigning
    // ids to the commands which are used to give the tools unique names (e.g. patchCard_ABC)
    // service should maintain a mapping of commandIds to command instances in order to map an apply
    // back to the correct command instance
    // Auto execute commands are commands that should be executed automatically if they are returned
    // as tool calls from the AI.

    let { roomId } = await this.commandContext.sendAiAssistantMessage({
      show: false, // maybe? open the side panel
      prompt: this.createPrompt(input),
      attachedCards: [prdCard],
      skillCards: [this.skillCard],
      commands: [{ command: patchPRDCommand, autoExecute: true }], // this should persist over multiple messages, matrix service is responsible to tracking whic
    });

    console.log('roomId', roomId);

    // Wait for the PRD command to have been applied
    await patchPRDCommand.waitForNextCompletion();
    // TODO: alternate approach is to have room have a goal, and monitor for that completion as opposed to command completion
    // TODO: alternate simpler approach, send a message and wait for a reply. If the reply is a the tool call, continue, otherwise, show room to the user and wait for the next reply

    console.log('prdCard after patch', prdCard);

    let reloadCommand = new ReloadCardCommand(this.commandContext);
    await reloadCommand.execute(prdCard);
    console.log('prdCard after reload', prdCard);
    let result = new CreateProductRequirementsResult();
    result.productRequirements = prdCard;
    result.roomId = roomId;
    return result;
  }

  async getInputType(): Promise<
    new (args: any) => CreateProductRequirementsInput
  > {
    return CreateProductRequirementsInput;
  }
}
