import { service } from '@ember/service';

import HostBaseTool from '../lib/host-base-tool';

import SendRequestViaProxyTool from './send-request-via-proxy';

import type MatrixService from '../services/matrix-service';
import type RealmServerService from '../services/realm-server';
import type ToolService from '../services/tool-service';
import type * as BaseToolModule from '@cardstack/base/command';

export default class SummarizeSessionTool extends HostBaseTool<
  typeof BaseToolModule.SummarizeSessionInput,
  typeof BaseToolModule.SummarizeSessionResult
> {
  @service declare private matrixService: MatrixService;
  @service declare private toolService: ToolService;
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'Summarize Session';
  description = 'Summarize the current session conversation';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { SummarizeSessionInput } = commandModule;
    return SummarizeSessionInput;
  }

  protected async run(
    input: BaseToolModule.SummarizeSessionInput,
  ): Promise<BaseToolModule.SummarizeSessionResult> {
    const commandModule = await this.loadToolModule();
    const { SummarizeSessionResult } = commandModule;

    try {
      const promptParts = await this.matrixService.getPromptParts(input.roomId);
      if (!promptParts?.shouldRespond) {
        return new SummarizeSessionResult({
          summary: null,
        });
      }

      const summarizationMessages = [
        ...(promptParts.messages ?? []),
        {
          role: 'user' as const,
          content:
            'Please provide a concise summary of this conversation. Focus on the key points, decisions made, and any important outcomes.',
        },
      ];
      const sendRequestViaProxyCommand = new SendRequestViaProxyTool(
        this.toolService.commandContext,
      );
      const result = await sendRequestViaProxyCommand.execute({
        url: 'https://openrouter.ai/api/v1/chat/completions',
        method: 'POST',
        requestBody: JSON.stringify({
          model: promptParts.model,
          messages: summarizationMessages,
        }),
      });

      if (!result.response.ok) {
        throw new Error(
          `Failed to generate summary: ${result.response.statusText}`,
        );
      }

      const responseData = await result.response.json();
      const summary =
        responseData.choices?.[0]?.message?.content || 'No summary generated';

      return new SummarizeSessionResult({
        summary,
      });
    } catch (error) {
      console.error('Session summarization error:', error);
      throw error;
    }
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { SummarizeSessionTool as SummarizeSessionCommand };
