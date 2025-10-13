import { service } from '@ember/service';

import { logger } from '@cardstack/runtime-common';
import { isResolvedCodeRef } from '@cardstack/runtime-common/code-ref';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import { prettifyPrompts } from '../utils/prettify-prompts';

import OneShotLlmRequestCommand from './one-shot-llm-request';
import { SearchCardsByTypeAndTitleCommand } from './search-cards';

// Command-level logger (general lifecycle + decisions)
const log = logger('commands:search-and-choose');

import type StoreService from '../services/store';

export default class SearchAndChooseCommand extends HostBaseCommand<
  typeof BaseCommandModule.SearchAndChooseInput,
  typeof BaseCommandModule.SearchAndChooseResult
> {
  @service declare private store: StoreService;

  static actionVerb = 'Select';
  description =
    'Search for instances of a card type and choose the most relevant subset via LLM';
  requireInputFields = ['codeRef'];

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { SearchAndChooseInput } = commandModule;
    return SearchAndChooseInput;
  }

  protected async run(
    input: BaseCommandModule.SearchAndChooseInput,
  ): Promise<BaseCommandModule.SearchAndChooseResult> {
    let { codeRef, max = 2, additionalSystemPrompt, llmModel } = input;

    if (!codeRef) {
      throw new Error('codeRef is required');
    }
    if (!isResolvedCodeRef(codeRef)) {
      throw new Error('codeRef must have an absolute module URL');
    }
    if (max < 1) {
      throw new Error('max must be at least 1');
    }

    // 1. Gather candidates via existing search command
    const search = new SearchCardsByTypeAndTitleCommand(this.commandContext);
    const searchResult = await search.execute({ type: codeRef });
    const instances = searchResult.instances ?? [];

    if (instances.length === 0) {
      log.debug('No instances found for type', { type: codeRef.name });
      const { SearchAndChooseResult } = await this.loadCommandModule();
      return new SearchAndChooseResult({ selectedIds: [], selectedCards: [] });
    }

    // 2. Prepare prompt content
    const summaries = this.instancesToPromptString(instances);
    let systemPrompt = `You are an expert catalog curator. Select the most relevant 1 to ${max} ids representing ${codeRef.name}. Output ONLY a JSON array of unique id strings. No commentary.`;
    if (additionalSystemPrompt && additionalSystemPrompt.trim()) {
      systemPrompt += ` ${additionalSystemPrompt.trim()}`;
    }
    const userPrompt = `Options (id :: title):\n${summaries}\n\nRules:\n- Return a JSON array with 1 to ${max} ids.\n- No duplicates.\n- Only use ids from the list.\n- If nothing is relevant return [].`;

    // 3. LLM selection
    const oneShot = new OneShotLlmRequestCommand(this.commandContext);

    // Unified prompt logging via reusable utility
    log.debug(
      prettifyPrompts({
        scope: `SearchAndChoose:${codeRef.name}`,
        systemPrompt,
        userPrompt,
      }),
    );
    const r = await oneShot.execute({
      systemPrompt,
      userPrompt,
      llmModel: llmModel || 'openai/gpt-5-nano',
      codeRef: codeRef,
    });

    const selectedIds = this.parseIdsFromOutput(r.output || '[]').slice(0, max);
    const selectedCards = instances.filter((inst: any) =>
      selectedIds.some(
        (id) => typeof inst.id === 'string' && inst.id.includes(id),
      ),
    );
    const { SearchAndChooseResult } = await this.loadCommandModule();
    return new SearchAndChooseResult({
      selectedIds,
      selectedCards,
    });
  }

  private parseIdsFromOutput(output: string): string[] {
    let text = output.trim();
    if (!text) return [];
    if (text.startsWith('```')) {
      text = text
        .replace(/^```[a-zA-Z0-9-*]*\n?/, '')
        .replace(/```$/, '')
        .trim();
    }
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((v) => typeof v === 'string');
    } catch {
      return [];
    }
  }

  private instancesToPromptString(instances: any[]): string {
    return instances
      .filter((c) => c && c.id)
      .map((c) => `${c.id} :: ${c.title || ''}`.trim())
      .join('\n');
  }
}
