import { logger } from '@cardstack/runtime-common';
import type { ResolvedCodeRef } from '@cardstack/runtime-common';
import { isResolvedCodeRef } from '@cardstack/runtime-common/code-ref';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

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
      max = 1,
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

    const { SearchAndChooseResult } = await this.loadCommandModule();

    // 1. Gather candidates via existing search command
    const search = new SearchCardsByTypeAndTitleCommand(this.commandContext);
    const searchResult = await search.execute({ type: candidateTypeCodeRef });
    const instances = searchResult.instances ?? [];

    if (instances.length === 0) {
      log.debug('No instances found for type', {
        type: candidateTypeCodeRef.name,
      });
      return new SearchAndChooseResult({ selectedIds: [], selectedCards: [] });
    }

    // 2. Prepare prompt content
    // Use numbered indices instead of raw IDs to prevent the LLM from
    // hallucinating IDs it knows from training data. Options are numbered starting
    // from 1 in the prompt, then mapped back to 0-based indices when selecting.
    const numberedCandidates = this.formatCandidatesAsNumberedList(instances);
    const isMaxOne = max === 1;

    let contextSection = '';
    if (selectionContextCodeRef) {
      contextSection = `Selection context: "${selectionContextCodeRef.name}" (${selectionContextCodeRef.module})`;
    }
    if (additionalSystemPrompt && additionalSystemPrompt.trim()) {
      contextSection += `${contextSection ? '\n' : ''}${additionalSystemPrompt.trim()}`;
    }
    const systemPrompt =
      'You are a selection assistant. Return only what is asked with no commentary.';
    const userPrompt = [
      `Choose the most relevant ${
        isMaxOne ? '1 option' : `1 to ${max} options`
      } for "${candidateTypeCodeRef.name}" from the numbered list below.`,
      contextSection,
      `Options:\n${numberedCandidates}`,
      isMaxOne
        ? `Return a JSON array containing exactly 1 number (the option number). If nothing is relevant return [].`
        : `Return a JSON array of numbers (the option numbers, no duplicates, up to ${max}). If nothing is relevant return [].`,
    ]
      .filter(Boolean)
      .join('\n\n');

    // 3. LLM selection
    const oneShot = new OneShotLlmRequestCommand(this.commandContext);

    const res = await oneShot.execute({
      systemPrompt,
      userPrompt,
      llmModel: llmModel || 'anthropic/claude-haiku-4.5',
      codeRef: selectionContextCodeRef ?? candidateTypeCodeRef,
    });

    const validInstances = instances.filter((c: any) => c && c.id);
    const selectedIndices = this.parseIndicesFromLlmOutput(
      res.output || '[]',
    ).slice(0, max);
    const selectedCards = selectedIndices
      .map((i) => validInstances[i - 1])
      .filter(Boolean);
    const selectedIds = selectedCards.map((c: any) => c.id);

    // Log a warning if the LLM output could not be parsed into valid selections, to aid debugging
    if (selectedCards.length === 0) {
      console.warn(
        `[SearchAndChoose:${candidateTypeCodeRef.name}] result is empty. candidates sent to LLM:\n${numberedCandidates}`,
      );
      console.warn(
        `[SearchAndChoose:${candidateTypeCodeRef.name}] LLM raw output: "${res.output}"`,
      );
      console.warn(
        `[SearchAndChoose:${candidateTypeCodeRef.name}] parsed indices:`,
        selectedIndices,
      );
    }

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
      throw new Error(`${fieldName} must be a resolved code ref`);
    }
    return codeRef;
  }

  private parseIndicesFromLlmOutput(output: string): number[] {
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
      return parsed.filter(
        (v): v is number =>
          typeof v === 'number' && Number.isInteger(v) && v > 0,
      );
    } catch {
      return [];
    }
  }

  private formatCandidatesAsNumberedList(instances: any[]): string {
    return instances
      .filter((c) => c && c.id)
      .map((c, i) => {
        const name = c.cardInfo?.name || c.name || '';
        const summary = c.cardInfo?.summary || '';
        return summary ? `${i + 1}. ${name} — ${summary}` : `${i + 1}. ${name}`;
      })
      .join('\n');
  }
}
