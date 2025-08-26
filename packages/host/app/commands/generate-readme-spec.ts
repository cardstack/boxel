import { service } from '@ember/service';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';
import { skillCardURL } from '../lib/utils';

import GenerateReadmeCommand from './generate-readme';
import PatchCardInstanceCommand from './patch-card-instance';

import type CommandService from '../services/command-service';

export default class GenerateReadmeSpecCommand extends HostBaseCommand<
  typeof BaseCommandModule.GenerateReadmeSpecInput,
  typeof BaseCommandModule.GenerateReadmeResult
> {
  @service declare private commandService: CommandService;

  private static readonly GENERATE_README_USER_PROMPT = `Create README documentation for this spec with a brief description and usage examples.`;
  private static readonly GENERATE_README_SYSTEM_PROMPT = `YOU ARE a proficient Boxel developer creating GitHub-style documentation. Use this structure:

• **Import**: Show how to import the component/field/card/command
• **Link**: Show how to link or define it in a card (e.g., @field myCard = linksTo(CardName) for cards, @field myField = contains(FieldName) for fields)
• **Template**: Show how to call it in templates using the fields API with format arguments (e.g., <@fields.myField @format='atom'/>)
• **Command**: Show how to instantiate and execute commands (e.g., new CommandName(context).execute(input))
• **Component**: Show how to use components in templates (e.g., <MyComponent @arg="value" />)

Code examples:
- Cards: show linksTo() usage
- Fields: show contains() and new FieldName() instantiation
- Commands: show instantiation and execution patterns
- Components: show template usage with arguments
- Include template usage with format options (atom, embedded, edit)

Keep examples minimal but complete. Return ONLY markdown content.

If skill cards are provided, use them for context but don't reference them in the output.`;

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
  ): Promise<BaseCommandModule.GenerateReadmeResult> {
    if (!input.spec) {
      throw new Error('Spec is required');
    }

    // Generate the README using the existing command
    const generateReadmeCommand = new GenerateReadmeCommand(
      this.commandService.commandContext,
    );

    const result = await generateReadmeCommand.execute({
      codeRef: {
        name: input.spec.ref.name,
        module: input.spec.moduleHref,
      },
      userPrompt: GenerateReadmeSpecCommand.GENERATE_README_USER_PROMPT,
      systemPrompt: GenerateReadmeSpecCommand.GENERATE_README_SYSTEM_PROMPT,
      llmModel: 'anthropic/claude-3-haiku',
      skillCardIds: [
        skillCardURL('boxel-development'),
        skillCardURL('source-code-editing'),
      ],
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
              readMe: result.readme,
            },
          },
        });

        console.log('README generated and spec updated successfully');
      } catch (patchError) {
        console.warn('README generated but could not update spec:', patchError);
        // Still return the generated result even if patching fails
      }
    }

    return result;
  }
}
