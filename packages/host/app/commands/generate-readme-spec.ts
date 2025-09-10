import { service } from '@ember/service';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

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

  private static getGenerateReadmeUserPrompt(ref: {
    name: string;
    module: string;
  }) {
    return `Create README documentation for this spec (${ref.name} from ${ref.module}) with a brief description and usage examples.`;
  }
  private static getGenerateReadmeSystemPrompt(ref: {
    name: string;
    module: string;
  }) {
    return `YOU ARE a proficient Boxel developer creating GitHub-style documentation for ${ref.name} from ${ref.module}. Use this structure:

• **Import**: Show how to es6 import the component/field/card/command. The code ref is (${ref.name} from ${ref.module}). Do not include .gts extension.
• **Link**: Show how to link or define it in a card (e.g., @field myCard = linksTo(CardName) for cards, @field myField = contains(FieldName) for fields)
• **Template**: Show how to call it in templates using the fields API with format arguments (e.g., <@fields.myField @format='atom'/>)
• **Dependencies**: Describe the special dependencies of this code (We only want KEY dependencies). Try to include import of other specs and/or extenrnal cdn 
• **Usage and Examples**: Show the primary way to use the code (Include the MOST obvious way to use). Keep it SIMPLE.

  Here are some examples you can offer based upon the type of the spec:
  - Card: show linksTo() and new CardDefName() instantiation 
  - Field: show contains() and new FieldName() instantiation
  - Command: show how to instantiate and execute commands (e.g., new CommandName(context).execute(input))
  - Component: show how to use glimmer component in templates (e.g., <MyComponent />) 

Additional Notes:
- DO NOT include the title header inside of the readme. 
- If skill cards are provided, use them for context but don't reference them in the output.`;
  }

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

    let userPrompt = GenerateReadmeSpecCommand.getGenerateReadmeUserPrompt(
      input.spec.ref,
    );
    let systemPrompt = GenerateReadmeSpecCommand.getGenerateReadmeSystemPrompt(
      input.spec.ref,
    );

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
