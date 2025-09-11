import { service } from '@ember/service';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';
import type { SpecType } from 'https://cardstack.com/base/spec';

import HostBaseCommand from '../lib/host-base-command';
import { skillCardURL } from '../lib/utils';

import OneShotLlmRequestCommand from './one-shot-llm-request';
import PatchCardInstanceCommand from './patch-card-instance';

import type CommandService from '../services/command-service';

export default class GenerateReadmeSpecCommand extends HostBaseCommand<
  typeof BaseCommandModule.GenerateReadmeSpecInput,
  typeof BaseCommandModule.GenerateReadmeSpecResult
> {
  @service declare private commandService: CommandService;

  private static getUserPrompt(
    ref: {
      name: string;
      module: string;
    },
    specType: SpecType,
  ) {
    return `Generate README documentation for a spec of type ${specType} that has code ref of (name:${ref.name}, module:${ref.module}). Show how to import and use it in inside a consuming card.`;
  }
  private static SYSTEM_PROMPT = `YOU ARE creating practical usage documentation for specs. 

Reference the Spec Documentation inside boxel-development skill for understanding spec types, but focus ONLY on crafting usage documentation. Based upon specType, create documentation with this structure:

• **Summary**: Brief summary of what the spec does 
• **Import**: Show ES6 import statement. Omit .gts extension.
• **Usage in Consuming Card**: Show how to use code within another card as a field
• **Template Usage**: Show how to invoke code inside a template 

Requirements:
- Keep examples simple and practical
- DO NOT include title headers
`;

  static actionVerb = 'Generate README for Spec';
  description =
    'Generate a README for a spec and patch it to the spec readMe field';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { GenerateReadmeSpecInput } = commandModule;
    return GenerateReadmeSpecInput;
  }

  protected async run(
    input: BaseCommandModule.GenerateReadmeSpecInput,
  ): Promise<BaseCommandModule.GenerateReadmeSpecResult> {
    if (!input.spec) {
      throw new Error('Spec is required');
    }

    // Generate the README using the existing command
    const generateReadmeCommand = new OneShotLlmRequestCommand(
      this.commandService.commandContext,
    );

    let userPrompt = GenerateReadmeSpecCommand.getUserPrompt(
      input.spec.ref,
      input.spec.specType as SpecType,
    );
    let systemPrompt = GenerateReadmeSpecCommand.SYSTEM_PROMPT;

    const result = await generateReadmeCommand.execute({
      codeRef: {
        name: input.spec.ref.name,
        module: input.spec.moduleHref,
      },
      userPrompt,
      systemPrompt,
      llmModel: 'anthropic/claude-3-haiku',
      skillCardIds: [skillCardURL('boxel-development')],
    });

    // Patch the spec's readMe field
    if (input.spec.id) {
      try {
        const patchCardInstanceCommand = new PatchCardInstanceCommand(
          this.commandService.commandContext,
          { cardType: input.spec.constructor as typeof CardDef }, //is this correct?
        );

        await patchCardInstanceCommand.execute({
          cardId: input.spec.id,
          patch: {
            attributes: {
              readMe: result.output,
            },
          },
        });

        console.log('README generated and spec updated successfully');
      } catch (patchError) {
        console.warn('README generated but could not update spec:', patchError);
        // Still return the generated result even if patching fails
      }
    }

    let commandModule = await this.loadCommandModule();
    const { GenerateReadmeSpecResult } = commandModule;

    return new GenerateReadmeSpecResult({
      readme: result.output,
    });
  }
}
