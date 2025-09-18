import { service } from '@ember/service';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import SendRequestViaProxyCommand from './send-request-via-proxy';

import type CommandService from '../services/command-service';
import type MatrixService from '../services/matrix-service';
import type RealmServerService from '../services/realm-server';

export default class SummarizeSessionCommand extends HostBaseCommand<
  typeof BaseCommandModule.SummarizeSessionInput,
  typeof BaseCommandModule.SummarizeSessionResult
> {
  @service declare private matrixService: MatrixService;
  @service declare private commandService: CommandService;
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'Summarize Session';
  description = 'Summarize the current session conversation';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { SummarizeSessionInput } = commandModule;
    return SummarizeSessionInput;
  }

  protected async run(
    input: BaseCommandModule.SummarizeSessionInput,
  ): Promise<BaseCommandModule.SummarizeSessionResult> {
    const commandModule = await this.loadCommandModule();
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
      const sendRequestViaProxyCommand = new SendRequestViaProxyCommand(
        this.commandService.commandContext,
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
