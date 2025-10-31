import { service } from '@ember/service';

import { isCardInstance, logger } from '@cardstack/runtime-common';

// Conventional module-scoped logger (pattern used elsewhere like store & realm events)
const oneShotLogger = logger('llm:oneshot');

import type * as BaseCommandModule from 'https://cardstack.com/base/command';
import type { Skill } from 'https://cardstack.com/base/skill';

import HostBaseCommand from '../lib/host-base-command';

import { prettifyPrompts } from '../utils/prettify-prompts';

import ReadTextFileCommand from './read-text-file';
import SendRequestViaProxyCommand from './send-request-via-proxy';

import type CommandService from '../services/command-service';
import type MatrixService from '../services/matrix-service';
import type RealmServerService from '../services/realm-server';
import type StoreService from '../services/store';

export default class OneShotLlmRequestCommand extends HostBaseCommand<
  typeof BaseCommandModule.OneShotLLMRequestInput,
  typeof BaseCommandModule.OneShotLLMRequestResult
> {
  @service declare private matrixService: MatrixService;
  @service declare private commandService: CommandService;
  @service declare private realmServer: RealmServerService;
  @service declare private store: StoreService;

  static actionVerb = 'Request';
  description = 'Execute a one-shot LLM request with custom prompts';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { OneShotLLMRequestInput } = commandModule;
    return OneShotLLMRequestInput;
  }

  protected async run(
    input: BaseCommandModule.OneShotLLMRequestInput,
  ): Promise<BaseCommandModule.OneShotLLMRequestResult> {
    const commandModule = await this.loadCommandModule();
    const { OneShotLLMRequestResult } = commandModule;

    if (!input.systemPrompt) {
      throw new Error('systemPrompt is required');
    }
    if (!input.userPrompt) {
      throw new Error('userPrompt is required');
    }

    oneShotLogger.debug(
      prettifyPrompts({
        scope: 'OneShotLLMRequest',
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
      }),
    );

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

      // Read attached file contents
      let attachedFilesContent = '';
      if (input.attachedFileURLs && input.attachedFileURLs.length > 0) {
        const readTextFileCommand = new ReadTextFileCommand(
          this.commandService.commandContext,
        );

        const attachedFilePromises = input.attachedFileURLs.map(
          async (fileUrl) => {
            try {
              const fileContents = await readTextFileCommand.execute({
                path: fileUrl,
              });
              return `\n\n--- ${fileUrl} ---\n${fileContents.content}`;
            } catch (error) {
              console.warn(`Failed to read attached file ${fileUrl}:`, error);
              return `\n\n--- ${fileUrl} ---\n[Error reading file: ${error}]`;
            }
          },
        );

        const attachedFileResults = await Promise.all(attachedFilePromises);
        attachedFilesContent = attachedFileResults.join('');
      }

      // Load skill cards from IDs if provided
      let loadedSkillCards: Skill[] = [];
      if (input.skillCardIds && input.skillCardIds.length > 0) {
        const skillCardPromises = input.skillCardIds.map(
          async (skillCardId) => {
            try {
              return await this.store.get<Skill>(skillCardId);
            } catch (e) {
              console.warn(`Failed to load skill card ${skillCardId}:`, e);
              return null;
            }
          },
        );

        const skillCardResults = await Promise.all(skillCardPromises);
        loadedSkillCards = skillCardResults.filter(
          (card): card is Skill => card !== null && isCardInstance(card),
        );
      }

      // Build system prompt with skill cards if provided
      let systemPrompt = input.systemPrompt;
      if (loadedSkillCards.length > 0) {
        systemPrompt += '\n\nAvailable Skills:\n';
        systemPrompt += skillCardsToMessage(loadedSkillCards);
      }

      const generationMessages = [
        {
          role: 'system' as const,
          content: systemPrompt,
        },
        {
          role: 'user' as const,
          content: `${input.userPrompt}

${fileContent ? `\`\`\`\n${fileContent}\n\`\`\`` : ''}${attachedFilesContent ? attachedFilesContent : ''}${!fileContent && !attachedFilesContent ? 'No file content available.' : ''}`,
        },
      ];
      oneShotLogger.debug('prepared messages', {
        systemPromptLength: systemPrompt.length,
        userPromptLength: input.userPrompt.length,
        fileContentIncluded: !!fileContent,
        attachedFilesCount: input.attachedFileURLs?.length || 0,
        skillCards: loadedSkillCards.map((c) => c.id),
      });

      const sendRequestViaProxyCommand = new SendRequestViaProxyCommand(
        this.commandService.commandContext,
      );
      const result = await sendRequestViaProxyCommand.execute({
        url: 'https://openrouter.ai/api/v1/chat/completions',
        method: 'POST',
        requestBody: JSON.stringify({
          model: input.llmModel || 'anthropic/claude-3-haiku',
          messages: generationMessages,
          stream: false,
        }),
      });

      if (!result.response.ok) {
        throw new Error(
          `Failed to execute LLM request: ${result.response.statusText}`,
        );
      }

      const responseData = await result.response.json();
      oneShotLogger.debug('raw llm response meta', {
        status: result.response.status,
        model: input.llmModel || 'anthropic/claude-3-haiku',
        usage: responseData.usage || null,
      });
      const output = responseData.choices?.[0]?.message?.content || null;
      oneShotLogger.debug('llm request complete', {
        outputPreview: output ? String(output).slice(0, 120) : null,
      });

      return new OneShotLLMRequestResult({
        output: output,
      });
    } catch (error) {
      oneShotLogger.error('LLM request error', { error });
      throw error;
    }
  }
}

export const skillCardsToMessage = (cards: Skill[]) => {
  return cards
    .map((card) => {
      return `Skill (id: ${card.id}):
${card.instructions}`;
    })
    .join('\n\n');
};
