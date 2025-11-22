import { service } from '@ember/service';

import { isCardInstance, logger } from '@cardstack/runtime-common';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import OneShotLlmRequestCommand from './one-shot-llm-request';
import {
  buildAttachedFileURLs,
  buildExamplePrompt,
  ONE_SHOT_SYSTEM_PROMPT,
  parseExamplePayloadFromOutput,
} from './example-card-helpers';

import type CardService from '../services/card-service';
import { prettifyPrompts } from '../utils/prettify-prompts';

const log = logger('commands:ask-ai-for-card-json');

export class AskAiForCardJsonCommand extends HostBaseCommand<
  typeof BaseCommandModule.AskAiForCardJsonInput,
  typeof BaseCommandModule.GenerateExamplePayloadResult
> {
  @service declare private cardService: CardService;

  static actionVerb = 'Request Payload';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { AskAiForCardJsonInput } = commandModule;
    return AskAiForCardJsonInput;
  }

  protected async run(
    input: BaseCommandModule.AskAiForCardJsonInput,
  ): Promise<BaseCommandModule.GenerateExamplePayloadResult> {
    if (!input.codeRef) {
      throw new Error('codeRef is required');
    }

    const promptSections = [buildExamplePrompt(1, input.codeRef)];

    let customPrompt =
      typeof input.prompt === 'string' && input.prompt.trim().length
        ? input.prompt.trim()
        : null;
    if (customPrompt) {
      promptSections.push(customPrompt);
    }

    const exampleCard = input.exampleCard as CardDef | undefined;
    if (exampleCard && isCardInstance(exampleCard)) {
      try {
        const serialized = await this.cardService.serializeCard(exampleCard);
        promptSections.push(
          `Existing example card JSON:\n${JSON.stringify(serialized?.data, null, 2)}`,
        );
      } catch (error) {
        console.warn('Failed to serialize example card for payload request', {
          error,
        });
      }
    }

    const userPrompt = promptSections.join('\n\n');
    const llmModel = input.llmModel || 'anthropic/claude-3-haiku';
    const attachedFileURLs = input.codeRef.module
      ? buildAttachedFileURLs(input.codeRef.module)
      : [];

    const oneShot = new OneShotLlmRequestCommand(this.commandContext);
    log.debug('Requesting payload from LLM', {
      model: llmModel,
      hasExampleCard: Boolean(exampleCard),
      codeRef: input.codeRef,
    });
    log.debug(
      prettifyPrompts({
        scope: 'AskAiForCardJson',
        systemPrompt: ONE_SHOT_SYSTEM_PROMPT,
        userPrompt,
      }),
    );
    const llmResult = await oneShot.execute({
      codeRef: input.codeRef,
      systemPrompt: ONE_SHOT_SYSTEM_PROMPT,
      userPrompt,
      llmModel,
      attachedFileURLs: attachedFileURLs.length ? attachedFileURLs : undefined,
    });

    const { payload } = parseExamplePayloadFromOutput(llmResult.output);
    if (!payload) {
      throw new Error('LLM response did not include a usable JSON payload');
    }
    log.debug('Received payload from LLM', {
      payloadPreview: (() => {
        try {
          return JSON.stringify(payload, null, 2);
        } catch {
          return '[unserializable payload]';
        }
      })(),
      rawOutputPresent: Boolean(llmResult.output),
    });

    let commandModule = await this.loadCommandModule();
    const { GenerateExamplePayloadResult } = commandModule;
    return new GenerateExamplePayloadResult({
      payload,
      rawOutput: llmResult.output ?? undefined,
    });
  }
}
