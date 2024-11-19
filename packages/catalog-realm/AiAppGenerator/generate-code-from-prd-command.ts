import {
  CardDef,
  StringField,
  contains,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import { ProductRequirementDocument } from '../product-requirement-document';
import CodeRefField from '../../base/code-ref';
import { Command } from '@cardstack/runtime-common';
import { SkillCard } from 'https://cardstack.com/base/skill-card';
import CreateModuleCommand from '../../host/app/commands/create-module';

export class GenerateCodeFromPRDInput extends CardDef {
  @field productRequirements = linksTo(ProductRequirementDocument);
  @field realm = contains(StringField);
  @field roomId = contains(StringField);
}

class GenerateCodeFromPRDResult extends CardDef {
  @field module = contains(CodeRefField);
  @field roomId = contains(StringField);
}

export default class GenerateCodeFromPRDCommand extends Command<
  GenerateCodeFromPRDInput,
  GenerateCodeFromPRDResult
> {
  get skillCard() {
    return new SkillCard({
      name: 'Boxel App Generator',
      description:
        'This skill card helps generate code from product requirements',
      instructions:
        'You are an expert programmer. Given product requirements, generate appropriate code that implements those requirements. Use the createModule command to create the module with the generated code.',
    });
  }

  async getInputType(): Promise<new (args: any) => GenerateCodeFromPRDInput> {
    return GenerateCodeFromPRDInput;
  }

  createPrompt(_prdCard: ProductRequirementDocument) {
    // TODO: use this PRD card value?
    return `Please analyze the provided product requirements and generate appropriate code to implement them. Consider best practices, maintainability, and performance.`;
  }

  protected async run(
    input: GenerateCodeFromPRDInput,
  ): Promise<GenerateCodeFromPRDResult> {
    // Get the create module command
    let createModuleCommand = new CreateModuleCommand(this.commandContext);

    // Send message to AI assistant with the PRD card and wait for it to generate code
    let { roomId } = await this.commandContext.sendAiAssistantMessage({
      roomId: input.roomId,
      show: true,
      prompt: this.createPrompt(input.productRequirements),
      attachedCards: [input.productRequirements],
      skillCards: [this.skillCard],
      commands: [{ command: createModuleCommand, autoExecute: true }],
    });

    // Wait for the module to be created
    const moduleCard = await createModuleCommand.waitForNextCompletion();

    let result = new GenerateCodeFromPRDResult();
    result.module = moduleCard.module;
    result.roomId = roomId;
    return result;
  }
}
