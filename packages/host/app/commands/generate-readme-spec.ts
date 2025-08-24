import { service } from '@ember/service';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import GenerateReadmeCommand from './generate-readme';
import PatchCardInstanceCommand from './patch-card-instance';

import type CommandService from '../services/command-service';

export default class GenerateReadmeSpecCommand extends HostBaseCommand<
  typeof BaseCommandModule.GenerateReadmeSpecInput,
  typeof BaseCommandModule.GenerateReadmeResult
> {
  @service declare private commandService: CommandService;

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
      userPrompt:
        'Return only the README markdown content showing how to import and use this in a card.',
      systemPrompt:
        'Generate a concise library-style README with Import and Usage sections. Focus on practical code examples. Return ONLY the README content as plain markdown, no explanations, no additional text, and no triple-tick markdown code blocks.',
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
