import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import ReadTextFileCommand from './read-text-file';
import SendRequestViaProxyCommand from './send-request-via-proxy';

import type CommandService from '../services/command-service';
import type MatrixService from '../services/matrix-service';
import type RealmServerService from '../services/realm-server';

export default class GenerateReadmeCommand extends HostBaseCommand<
  typeof BaseCommandModule.GenerateReadmeInput,
  typeof BaseCommandModule.GenerateReadmeResult
> {
  @service declare private matrixService: MatrixService;
  @service declare private commandService: CommandService;
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'Generate README';
  description = 'Generate a README based on the current context';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { GenerateReadmeInput } = commandModule;
    return GenerateReadmeInput;
  }

  protected async run(
    input: BaseCommandModule.GenerateReadmeInput,
  ): Promise<BaseCommandModule.GenerateReadmeResult> {
    const commandModule = await this.loadCommandModule();
    const { GenerateReadmeResult } = commandModule;

    if (!input.systemPrompt) {
      throw new Error('systemPrompt is required');
    }
    if (!input.userPrompt) {
      throw new Error('userPrompt is required');
    }

    try {
      // Read the file contents using the codeRef
      let fileContent = '';
      if (input.codeRef?.module) {
        const readTextFileCommand = new ReadTextFileCommand(
          this.commandService.commandContext,
        );
        const fileContents = await readTextFileCommand.execute({
          path: input.codeRef.module,
        });
        fileContent = fileContents.content;
      }

      if (!fileContent) {
        throw new Error('No file content available to generate README');
      }

      const generationMessages = [
        {
          role: 'system' as const,
          content: input.systemPrompt,
        },
        {
          role: 'user' as const,
          content: `${input.userPrompt}

${fileContent ? `\`\`\`\n${fileContent}\n\`\`\`` : 'No file content available.'}`,
        },
      ];

      console.log(generationMessages);

      const sendRequestViaProxyCommand = new SendRequestViaProxyCommand(
        this.commandService.commandContext,
      );
      const result = await sendRequestViaProxyCommand.execute({
        url: 'https://openrouter.ai/api/v1/chat/completions',
        method: 'POST',
        requestBody: JSON.stringify({
          model: 'anthropic/claude-3.5-sonnet',
          messages: generationMessages,
          stream: false,
        }),
      });

      if (!result.response.ok) {
        throw new Error(
          `Failed to generate README: ${result.response.statusText}`,
        );
      }

      const responseData = await result.response.json();
      const readme =
        responseData.choices?.[0]?.message?.content || 'No README generated';

      return new GenerateReadmeResult({
        readme: readme,
      });
    } catch (error) {
      console.error('README generation error:', error);
      throw error;
    }
  }
}
