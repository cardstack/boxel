import { Command, CommandRequest } from '@cardstack/runtime-common';
import {
  CardDef,
  StringField,
  contains,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import { ProductRequirementDocument } from '../product-requirement-document';
import { Skill } from 'https://cardstack.com/base/skill';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import CreateAiAssistantRoomCommand from '@cardstack/boxel-host/commands/create-ai-assistant-room';
import AddSkillsToRoomCommand from '@cardstack/boxel-host/commands/add-skills-to-room';
import SendAiAssistantMessageCommand from '@cardstack/boxel-host/commands/send-ai-assistant-message';
import OpenAiAssistantRoomCommand from '@cardstack/boxel-host/commands/open-ai-assistant-room';
import { waitForCompletedCommandRequest } from '@cardstack/boxel-host/commands/utils';

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
  typeof CreateProductRequirementsInput,
  typeof CreateProductRequirementsResult
> {
  static actionVerb = 'Create';
  inputType = CreateProductRequirementsInput;

  get skillCard() {
    return new Skill({
      id: 'prd-helper-skill',
      name: 'PRD Helper',
      description:
        'This skill card can be used to help with creating product requirements',
      instructions: `Given a prompt, fill in the product requirements document.
        Update the appTitle.
        Update the prompt to be grammatically accurate.
        Description should be 1 or 2 short sentences.
        In overview, provide 1 or 2 paragraph summary of the most important ways this app will meet the needs of the target audience. The capabilites of the platform allow creating types that can be linked to other types, and creating fields.

        For the schema, consider the types required. Write out the schema as a mermaid class diagram.

        NEVER offer to update the card, you MUST call patchCardInstance in your response.`,
    });
  }

  createPrompt(input: CreateProductRequirementsInput) {
    return `Create product requirements for ${input.targetAudience} with the following description: ${input.productDescription}. Focus on the following features: ${input.features}`;
  }

  protected async run(
    input: CreateProductRequirementsInput,
  ): Promise<CreateProductRequirementsResult> {
    // Create new card
    let prdCard = new ProductRequirementDocument();

    let saveCardCommand = new SaveCardCommand(this.commandContext);
    await saveCardCommand.execute({
      realm: input.realm,
      card: prdCard,
    });
    // Get patch command, this takes the card and returns a command that can be used to patch the card
    let createRoomCommand = new CreateAiAssistantRoomCommand(
      this.commandContext,
    );
    let { roomId } = await createRoomCommand.execute({
      name: 'Product Requirements Doc Creation',
    });

    let openAiAssistantRoomCommand = new OpenAiAssistantRoomCommand(
      this.commandContext,
    );
    await openAiAssistantRoomCommand.execute({
      roomId,
    });

    let addSkillsToRoomCommand = new AddSkillsToRoomCommand(
      this.commandContext,
    );
    await addSkillsToRoomCommand.execute({
      roomId,
      skills: [this.skillCard],
    });
    let sendAiAssistantMessageCommand = new SendAiAssistantMessageCommand(
      this.commandContext,
    );
    let { eventId } = await sendAiAssistantMessageCommand.execute({
      roomId,
      prompt: this.createPrompt(input),
      attachedCards: [prdCard],
    });

    // Wait for the card to have been patched
    await waitForCompletedCommandRequest(
      this.commandContext,
      roomId,
      (commandRequest: Partial<CommandRequest>) =>
        commandRequest.name === 'patchCardInstance',
      { afterEventId: eventId },
    );

    let result = new CreateProductRequirementsResult();
    result.productRequirements = prdCard;
    result.roomId = roomId;
    return result;
  }

  async getInputType() {
    return CreateProductRequirementsInput;
  }
}
