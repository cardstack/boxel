import { logger } from '@cardstack/runtime-common';
import type { ResolvedCodeRef } from '@cardstack/runtime-common';
import { isResolvedCodeRef } from '@cardstack/runtime-common/code-ref';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import { prettifyPrompts } from '../utils/prettify-prompts';

import OneShotLlmRequestCommand from './one-shot-llm-request';
import { SearchCardsByTypeAndTitleCommand } from './search-cards';

// Command-level logger (general lifecycle + decisions)
const log = logger('commands:search-and-choose');

export default class SearchAndChooseCommand extends HostBaseCommand<
  typeof BaseCommandModule.SearchAndChooseInput,
  typeof BaseCommandModule.SearchAndChooseResult
> {
  static actionVerb = 'Select';
  description =
    'Search for instances of a card type and choose the most relevant subset via LLM';
  requireInputFields = ['candidateTypeCodeRef'];

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { SearchAndChooseInput } = commandModule;
    return SearchAndChooseInput;
  }

  protected async run(
    input: BaseCommandModule.SearchAndChooseInput,
  ): Promise<BaseCommandModule.SearchAndChooseResult> {
    let {
      sourceContextCodeRef,
      max = 2,
      additionalSystemPrompt,
      llmModel,
    } = input;
    let candidateTypeCodeRef = this.assertResolvedCodeRef(
      input.candidateTypeCodeRef,
      'candidateTypeCodeRef',
    );
    let selectionContextCodeRef = sourceContextCodeRef
      ? this.assertResolvedCodeRef(sourceContextCodeRef, 'sourceContextCodeRef')
      : undefined;
    if (max < 1) {
      throw new Error('max must be at least 1');
    }

    // 1. Gather candidates via existing search command
    const search = new SearchCardsByTypeAndTitleCommand(this.commandContext);
    const searchResult = await search.execute({ type: candidateTypeCodeRef });
    const instances = searchResult.instances ?? [];

    if (instances.length === 0) {
      log.debug('No instances found for type', {
        type: candidateTypeCodeRef.name,
      });
      const { SearchAndChooseResult } = await this.loadCommandModule();
      return new SearchAndChooseResult({ selectedIds: [], selectedCards: [] });
    }

    // 2. Prepare prompt content
    const summaries = this.formatCandidatesForPrompt(instances);
    let systemPrompt = `You are an expert catalog curator. Select the most relevant 1 to ${max} ids representing ${candidateTypeCodeRef.name}. Output ONLY a JSON array of unique id strings. No commentary.`;
    if (selectionContextCodeRef) {
      systemPrompt += ` Use the attached module source for "${selectionContextCodeRef.name}" (${selectionContextCodeRef.module}) as selection context.`;
    }
    if (additionalSystemPrompt && additionalSystemPrompt.trim()) {
      systemPrompt += ` ${additionalSystemPrompt.trim()}`;
    }
    const userPrompt = `Options (id :: title):\n${summaries}\n\nRules:\n- Return a JSON array with 1 to ${max} ids.\n- No duplicates.\n- Only use ids from the list.\n- If nothing is relevant return [].`;

    // 3. LLM selection
    const oneShot = new OneShotLlmRequestCommand(this.commandContext);

    // Unified prompt logging via reusable utility
    log.debug(
      prettifyPrompts({
        scope: `SearchAndChoose:${candidateTypeCodeRef.name}`,
        systemPrompt,
        userPrompt,
      }),
    );
    const r = await oneShot.execute({
      systemPrompt,
      userPrompt,
      llmModel: llmModel || 'anthropic/claude-3-haiku',
      ...(selectionContextCodeRef ? { codeRef: selectionContextCodeRef } : {}),
    });

    const selectedIds = this.parseIdsFromLlmOutput(r.output || '[]').slice(
      0,
      max,
    );
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

  private assertResolvedCodeRef(
    codeRef: BaseCommandModule.SearchAndChooseInput['candidateTypeCodeRef'],
    fieldName: 'candidateTypeCodeRef' | 'sourceContextCodeRef',
  ): ResolvedCodeRef {
    if (!codeRef) {
      throw new Error(`${fieldName} is required`);
    }
    if (!isResolvedCodeRef(codeRef)) {
      throw new Error(`${fieldName} must have an absolute module URL`);
    }
    return codeRef;
  }

  private parseIdsFromLlmOutput(output: string): string[] {
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

  private formatCandidatesForPrompt(instances: any[]): string {
    return instances
      .filter((c) => c && c.id)
      .map((c) => `${c.id} :: ${c.title || ''}`.trim())
      .join('\n');
  }
}
