import { service } from '@ember/service';

import { isCardInstance, logger } from '@cardstack/runtime-common';
// Conventional module-scoped logger (pattern used elsewhere like store & realm events)
const oneShotLogger = logger('llm:oneshot');

import HostBaseTool from '../lib/host-base-tool';

import { prettifyMessages } from '../utils/prettify-messages';
import { prettifyPrompts } from '../utils/prettify-prompts';

import ReadSourceTool from './read-source';
import ReadTextFileTool from './read-text-file';
import SendRequestViaProxyTool from './send-request-via-proxy';

import type MatrixService from '../services/matrix-service';
import type RealmServerService from '../services/realm-server';
import type StoreService from '../services/store';
import type ToolService from '../services/tool-service';
import type * as BaseToolModule from '@cardstack/base/command';
import type { Skill } from '@cardstack/base/skill';

export default class OneShotLlmRequestTool extends HostBaseTool<
  typeof BaseToolModule.OneShotLLMRequestInput,
  typeof BaseToolModule.OneShotLLMRequestResult
> {
  @service declare private matrixService: MatrixService;
  @service declare private toolService: ToolService;
  @service declare private realmServer: RealmServerService;
  @service declare private store: StoreService;

  static actionVerb = 'Request';
  description = 'Execute a one-shot LLM request with custom prompts';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { OneShotLLMRequestInput } = commandModule;
    return OneShotLLMRequestInput;
  }

  protected async run(
    input: BaseToolModule.OneShotLLMRequestInput,
  ): Promise<BaseToolModule.OneShotLLMRequestResult> {
    const commandModule = await this.loadToolModule();
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
        const readSourceCommand = new ReadSourceTool(
          this.toolService.commandContext,
        );
        const fileContents = await readSourceCommand.execute({
          path: input.codeRef.module,
        });
        fileContent = fileContents.content;
      }

      // Read attached file contents
      let attachedFilesContent = '';
      if (
        input.attachedFileIdentifiers &&
        input.attachedFileIdentifiers.length > 0
      ) {
        const readTextFileCommand = new ReadTextFileTool(
          this.toolService.commandContext,
        );

        const attachedFilePromises = input.attachedFileIdentifiers.map(
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

      let skillInstructions =
        loadedSkillCards.length > 0
          ? `Available Skills:\n${skillsToMessage(loadedSkillCards)}`
          : '';

      let systemPrompt = input.systemPrompt;

      const fileSection = `${fileContent ? `\`\`\`\n${fileContent}\n\`\`\`` : ''}${attachedFilesContent ? attachedFilesContent : ''}${!fileContent && !attachedFilesContent ? 'No file content available.' : ''}`;

      let userContent = [input.userPrompt, skillInstructions, fileSection]
        .filter((section) => section && section.trim().length > 0)
        .join('\n\n');

      const generationMessages = [
        {
          role: 'system' as const,
          content: systemPrompt,
        },
        {
          role: 'user' as const,
          content: userContent,
        },
      ];
      oneShotLogger.debug(
        prettifyMessages(
          generationMessages.map((message) => ({
            role: message.role,
            content:
              typeof message.content === 'string'
                ? message.content
                : String(message.content),
          })),
        ),
      );
      oneShotLogger.debug('prepared messages', {
        systemPromptLength: systemPrompt.length,
        userPromptLength: userContent.length,
        fileContentIncluded: !!fileContent,
        attachedFilesCount: input.attachedFileIdentifiers?.length || 0,
        skillCards: loadedSkillCards.map((c) => c.id),
      });

      const sendRequestViaProxyCommand = new SendRequestViaProxyTool(
        this.toolService.commandContext,
      );
      const result = await sendRequestViaProxyCommand.execute({
        url: 'https://openrouter.ai/api/v1/chat/completions',
        method: 'POST',
        requestBody: JSON.stringify({
          model: input.llmModel || 'anthropic/claude-haiku-4.5',
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
      const output = responseData.choices?.[0]?.message?.content || null;
      oneShotLogger.debug('llm request complete', output);

      return new OneShotLLMRequestResult({
        output: output,
      });
    } catch (error) {
      oneShotLogger.error('LLM request error', { error });
      throw error;
    }
  }
}

const skillsToMessage = (cards: Skill[]) => {
  return cards
    .map((card) => {
      let instructions =
        typeof (card as any).instructions === 'string'
          ? (card as any).instructions.trim()
          : '';
      return `Skill (id: ${card.id}):\n${instructions || '[no instructions]'}`;
    })
    .join('\n\n');
};

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { OneShotLlmRequestTool as OneShotLlmRequestCommand };
