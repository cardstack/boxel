import { service } from '@ember/service';

import {
  type LooseSingleCardDocument,
  type ResolvedCodeRef,
  isCardDef,
  loadCardDef,
} from '@cardstack/runtime-common';
import { codeRefWithAbsoluteURL } from '@cardstack/runtime-common/code-ref';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import OneShotLlmRequestCommand from './one-shot-llm-request';

import type CardService from '../services/card-service';
import type RealmService from '../services/realm';
import type StoreService from '../services/store';

/**
 * Bulk card generator sketch
 *
 * The idea:
 *   - Caller specifies a card definition via `codeRef`.
 *   - Command asks an LLM to return an array of serialized card payloads.
 *   - Payloads are converted into `LooseSingleCardDocument`s.
 *   - We persist them using a hypothetical `store.addMany` atomic helper.
 *
 * Notes:
 *   - `store.addMany` does not exist yet; we guard against it missing.
 *   - Returned cards are linked to the result so callers can open/edit them.
 *   - Validation/error handling is intentionally lightweight for this outline.
 */
export default class GenerateCardsBulkCommand extends HostBaseCommand<
  typeof BaseCommandModule.GenerateCardsBulkInput,
  typeof BaseCommandModule.GenerateCardsBulkResult
> {
  @service declare private store: StoreService;
  @service declare private realm: RealmService;
  @service declare private cardService: CardService;

  static actionVerb = 'Generate';
  description =
    'Generate multiple card instances from a code reference using an AI payload and batched store writes.';

  requireInputFields = ['codeRef', 'count', 'localDir'];

  private cardClassCache: Map<string, typeof CardDef> = new Map();

  async getInputType() {
    const commandModule = await this.loadCommandModule();
    const { GenerateCardsBulkInput } = commandModule;
    return GenerateCardsBulkInput;
  }

  async getResultType() {
    const commandModule = await this.loadCommandModule();
    const { GenerateCardsBulkResult } = commandModule;
    return GenerateCardsBulkResult;
  }

  protected async run(
    input: BaseCommandModule.GenerateCardsBulkInput,
  ): Promise<BaseCommandModule.GenerateCardsBulkResult> {
    const codeRef = this.resolveCodeRef(input);
    if (!codeRef) {
      throw new Error('Unable to resolve codeRef.');
    }

    const targetRealm =
      input.targetRealm ?? this.realm.defaultWritableRealm?.path;
    if (!targetRealm) {
      throw new Error('No writable realm specified.');
    }

    const cardClass = await this.loadCardClass(codeRef);
    const payloads = await this.askLLMForPayloads(input, codeRef);
    console.debug('[GenerateCardsBulk] LLM payload:', payloads);
    if (!payloads || payloads.length === 0) {
      throw new Error('LLM did not return any payloads.');
    }

    const documents = await this.buildDocuments(payloads, codeRef, cardClass);
    if (!documents.length) {
      throw new Error('No valid documents were generated from the payload.');
    }

    const storeWithAddMany = this.store as StoreService & {
      addMany?: (
        docs: LooseSingleCardDocument[],
        opts?: { realm?: string; localDir?: string },
      ) => Promise<CardDef[]>;
    };
    if (!storeWithAddMany.addMany) {
      throw new Error(
        'store.addMany is not implemented. See store-atomic-write-plan.md for details.',
      );
    }

    const localDir = this.normalizeLocalDir(input.localDir);
    if (!localDir) {
      throw new Error('A localDir is required to store generated cards.');
    }

    const createdCards = await storeWithAddMany.addMany(documents, {
      realm: targetRealm,
      localDir,
    });

    const commandModule = await this.loadCommandModule();
    const { GenerateCardsBulkResult } = commandModule;
    return new GenerateCardsBulkResult({
      cards: createdCards,
    });
  }

  private resolveCodeRef(
    input: BaseCommandModule.GenerateCardsBulkInput,
  ): ResolvedCodeRef | undefined {
    try {
      return codeRefWithAbsoluteURL(
        input.codeRef,
        input.targetRealm ? new URL(input.targetRealm) : undefined,
      ) as ResolvedCodeRef;
    } catch {
      return undefined;
    }
  }

  /**
   * Ask the LLM to produce N serialized card payloads.
   * We keep the prompt simple for now.
   */
  private async askLLMForPayloads(
    input: BaseCommandModule.GenerateCardsBulkInput,
    codeRef: ResolvedCodeRef,
  ): Promise<Array<Record<string, unknown>>> {
    const oneShot = new OneShotLlmRequestCommand(this.commandContext);

    const systemPrompt = `You are Boxel's card generation assistant.
Return ONLY JSON matching this shape:
{
  "items": [
    {
      "card": {
        "type": "card",
        "attributes": {...},
        "relationships": {... optional ...},
        "meta": {... optional ...}
      }
    }
  ]
}
No prose, no markdown fences.`;

    const additionalGuidance = input.prompt
      ? `Additional guidance:\n${input.prompt}`
      : undefined;

    const userPrompt = `
Card definition: ${codeRef.module}#${codeRef.name ?? 'default'}
Count: ${input.count}
${additionalGuidance ?? ''}

Return ${input.count} distinct items with realistic data for this card type.`.trim();

    const formattedPrompt = this.prettifyPrompt(systemPrompt, userPrompt);
    console.debug('[GenerateCardsBulk] prompt:\n', formattedPrompt);

    const response = await oneShot.execute({
      systemPrompt,
      userPrompt,
      codeRef,
      llmModel: input.llmModel ?? 'anthropic/claude-3-5-sonnet',
    });

    const raw = Array.isArray(response.output)
      ? response.output.join('\n')
      : response.output;
    const text = this.stripCodeFences(raw ?? '').trim();
    console.debug('[GenerateCardsBulk] raw response:', text);
    if (!text) {
      return [];
    }

    try {
      const parsed = JSON.parse(text);
      console.debug('[GenerateCardsBulk] parsed response:', parsed);
      return Array.isArray(parsed?.items)
        ? (parsed.items as Array<Record<string, unknown>>)
        : [];
    } catch {
      return [];
    }
  }

  private async buildDocuments(
    payloads: Array<Record<string, unknown>>,
    codeRef: ResolvedCodeRef,
    Card: typeof CardDef,
  ): Promise<LooseSingleCardDocument[]> {
    const documents: LooseSingleCardDocument[] = [];

    for (let payload of payloads) {
      const normalized = this.normalizePayload(payload);
      if (!normalized) {
        continue;
      }

      const cardInstance = new Card(normalized.attributes ?? {});
      const serialized = await this.cardService.serializeCard(cardInstance);

      serialized.data = {
        ...serialized.data,
        meta: {
          ...(serialized.data.meta ?? {}),
          ...normalized.meta,
          adoptsFrom: {
            module: codeRef.module,
            name: codeRef.name ?? 'default',
          },
        },
      };

      // Relationships are currently out-of-scope for the bulk helper.
      delete serialized.data.relationships;

      documents.push(serialized);
    }

    return documents;
  }

  private async loadCardClass(
    codeRef: ResolvedCodeRef,
  ): Promise<typeof CardDef> {
    const key = this.codeRefCacheKey(codeRef);
    if (this.cardClassCache.has(key)) {
      return this.cardClassCache.get(key)!;
    }
    const cardDef = await loadCardDef(codeRef, {
      loader: this.loaderService.loader,
    });
    if (!isCardDef(cardDef)) {
      throw new Error('Code ref does not point to a card definition.');
    }
    const cardClass = cardDef as typeof CardDef;
    this.cardClassCache.set(key, cardClass);
    return cardClass;
  }

  private codeRefCacheKey(codeRef: ResolvedCodeRef): string {
    return `${codeRef.module}#${codeRef.name ?? 'default'}`;
  }

  private prettifyPrompt(systemPrompt: string, userPrompt: string): string {
    return [
      '--- GenerateCardsBulkCommand Prompt ---',
      'System Prompt:',
      systemPrompt,
      '',
      'User Prompt:',
      userPrompt,
      '---------------------------------------',
    ].join('\n');
  }

  private normalizePayload(
    payload: Record<string, unknown>,
  ):
    | { attributes: Record<string, unknown>; meta?: Record<string, unknown> }
    | undefined {
    const card = payload.card;
    if (!card || typeof card !== 'object') {
      return undefined;
    }

    const attributesCandidate = (card as Record<string, unknown>).attributes;
    if (attributesCandidate && typeof attributesCandidate !== 'object') {
      return undefined;
    }

    const metaCandidate = (card as Record<string, unknown>).meta;

    return {
      attributes:
        (attributesCandidate as Record<string, unknown> | undefined) ?? {},
      meta:
        metaCandidate && typeof metaCandidate === 'object'
          ? (metaCandidate as Record<string, unknown>)
          : undefined,
    };
  }

  private normalizeLocalDir(value?: string): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  }

  private stripCodeFences(text: string): string {
    if (!text) {
      return '';
    }
    let trimmed = String(text).trim();
    if (trimmed.startsWith('```')) {
      trimmed = trimmed
        .replace(/^```[a-zA-Z0-9-]*\n?/, '')
        .replace(/```$/, '')
        .trim();
    }
    return trimmed;
  }
}
