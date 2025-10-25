import { service } from '@ember/service';

import {
  ensureExtension,
  isCardInstance,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import {
  codeRefWithAbsoluteURL,
  isResolvedCodeRef,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common/code-ref';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import { prettifyPrompts } from '../utils/prettify-prompts';

import OneShotLlmRequestCommand from './one-shot-llm-request';
import SendAiAssistantMessageCommand from './send-ai-assistant-message';

import type AiAssistantPanelService from '../services/ai-assistant-panel-service';
import type CardService from '../services/card-service';
import type MatrixService from '../services/matrix-service';
import type RealmService from '../services/realm';
import type StoreService from '../services/store';

const ONE_SHOT_SYSTEM_PROMPT = `You are Boxel's sample data assistant. When given a card definition you return JSON that can seed a new instance.

Rules:
- Always respond with valid JSON.
- Respond with a single JSON object representing the generated example.
- Do not include prose, code fences, or wrapper structures such as arrays.
- Each example should include realistic values for the card's required fields.`;

const buildExamplePrompt = (count = 1, codeRef?: { name?: string }) => {
  let lines = [
    count === 1
      ? 'Generate a single additional instance of the specified card definition, populated with sample data.'
      : `Generate ${count} additional instances of the specified card definition, populated with sample data.`,
    'Provide realistic, distinct values so the new instance is unique from existing examples.',
    'Respond ONLY with the JSON object for the example—no prose, code fences, or wrapper structures.',
  ];
  if (codeRef?.name) {
    lines.push(`Card definition name: ${codeRef.name}`);
  }
  return lines.join(' ');
};

function buildAttachedFileURLs(modulePath?: string) {
  if (!modulePath) {
    return [];
  }
  let cardModuleURL = ensureExtension(modulePath, {
    default: '.gts',
  });
  return cardModuleURL ? [cardModuleURL] : [];
}

export default class GenerateExampleCardsCommand extends HostBaseCommand<
  typeof BaseCommandModule.CreateInstancesInput,
  undefined
> {
  @service declare private aiAssistantPanelService: AiAssistantPanelService;
  @service declare private matrixService: MatrixService;
  @service declare private realm: RealmService;

  static actionVerb = 'Generate Example Cards';
  description = 'Create new cards populated with sample data';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CreateInstancesInput } = commandModule;
    return CreateInstancesInput;
  }

  protected getPrompt(count: number) {
    return `Generate ${count} additional instances of the specified card definition, populated with sample data.`;
  }

  protected getAttachedFileURLs(input: BaseCommandModule.CreateInstancesInput) {
    return buildAttachedFileURLs(input.codeRef?.module);
  }

  protected async run(
    input: BaseCommandModule.CreateInstancesInput,
  ): Promise<undefined> {
    if (!input.codeRef) {
      throw new Error('Module is required');
    }
    let realm = input.realm || this.realm.defaultWritableRealm?.path;

    await this.aiAssistantPanelService.openPanel();

    const userPrompt = this.getPrompt(input.count || 1);
    console.debug(
      prettifyPrompts({
        scope: 'GenerateExample:Panel',
        systemPrompt: '(handled by AI assistant room)',
        userPrompt,
      }),
    );

    let sendMessageCommand = new SendAiAssistantMessageCommand(
      this.commandContext,
    );

    await sendMessageCommand.execute({
      roomId: this.matrixService.currentRoomId,
      prompt: userPrompt,
      attachedCards: input.exampleCard ? [input.exampleCard] : [],
      attachedFileURLs: this.getAttachedFileURLs(input),
      realmUrl: realm,
    });
  }
}

export class GenerateExampleCardsOneShotCommand extends HostBaseCommand<
  typeof BaseCommandModule.CreateInstancesInput,
  typeof BaseCommandModule.CreateInstanceResult
> {
  @service declare private realm: RealmService;
  @service declare private store: StoreService;
  @service declare private cardService: CardService;

  static actionVerb = 'Generate Example (One-shot)';

  description =
    'Create a new card instance populated with sample data via a direct LLM request';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CreateInstancesInput } = commandModule;
    return CreateInstancesInput;
  }

  protected async run(
    input: BaseCommandModule.CreateInstancesInput,
  ): Promise<BaseCommandModule.CreateInstanceResult> {
    if (!input.codeRef) {
      throw new Error('Module is required');
    }

    const realm = input.realm || this.realm.defaultWritableRealm?.path;

    const promptSections = [
      buildExamplePrompt(1, input.codeRef),
      `Card definition module: ${input.codeRef.module}`,
    ];

    if (realm) {
      promptSections.push(`Use realm URL ${realm} when generating any links.`);
    }

    const exampleCard = input.exampleCard as CardDef | undefined;
    if (exampleCard?.id) {
      promptSections.push(
        `Existing example card id: ${exampleCard.id}. Provide fresh sample data that differs from this instance.`,
      );
    }
    let serializedExampleJson: string | undefined;
    if (exampleCard && isCardInstance(exampleCard)) {
      try {
        const serialized = await this.cardService.serializeCard(exampleCard);
        serializedExampleJson = JSON.stringify(serialized?.data, null, 2);
      } catch (error) {
        console.warn('Failed to serialize current example card', { error });
      }
    }
    if (serializedExampleJson) {
      promptSections.push(
        `Existing example card JSON:\n${serializedExampleJson}`,
      );
    }

    const userPrompt = promptSections.join('\n\n');
    console.debug(
      prettifyPrompts({
        scope: 'GenerateExample:OneShot',
        systemPrompt: ONE_SHOT_SYSTEM_PROMPT,
        userPrompt,
      }),
    );

    const oneShot = new OneShotLlmRequestCommand(this.commandContext);
    const attachedFileURLs = buildAttachedFileURLs(input.codeRef.module);
    const llmResult = await oneShot.execute({
      codeRef: input.codeRef,
      systemPrompt: ONE_SHOT_SYSTEM_PROMPT,
      userPrompt,
      llmModel: 'anthropic/claude-3-haiku',
      attachedFileURLs:
        attachedFileURLs.length > 0 ? attachedFileURLs : undefined,
    });

    const { payload: examplePayload } = this.parseExamplePayload(
      llmResult.output,
    );
    if (!examplePayload) {
      throw new Error('LLM did not return a valid JSON example payload');
    }
    const createdCard = await this.createExampleInstance(
      input.codeRef,
      examplePayload,
      realm,
    ).catch((error) => {
      console.warn('Failed to create generated example card', {
        codeRef: input.codeRef,
        realm,
        error,
      });
      return undefined;
    });
    if (!createdCard) {
      throw new Error('Failed to create generated example card');
    }

    const commandModule = await this.loadCommandModule();
    const { CreateInstanceResult } = commandModule;
    return new CreateInstanceResult({ createdCard });
  }

  private parseExamplePayload(output?: string | null): {
    payload?: Record<string, unknown>;
  } {
    if (!output) {
      return {};
    }
    const jsonString = this.extractJsonString(output);
    if (!jsonString) {
      return {};
    }
    try {
      const parsed = JSON.parse(jsonString);
      const payload = this.coerceExamplePayload(parsed);
      if (!payload) {
        return {};
      }
      return {
        payload,
      };
    } catch (error) {
      console.warn('Failed to parse JSON from LLM output', { error });
      return {};
    }
  }

  private coerceExamplePayload(
    value: unknown,
  ): Record<string, unknown> | undefined {
    if (!value) {
      return undefined;
    }
    if (Array.isArray(value)) {
      const first = value.find((item) => item && typeof item === 'object');
      return first ? { ...(first as Record<string, unknown>) } : undefined;
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (Array.isArray(record.examples)) {
        const first = record.examples.find(
          (item) => item && typeof item === 'object',
        );
        return first ? { ...(first as Record<string, unknown>) } : undefined;
      }
      if (record.example && typeof record.example === 'object') {
        return { ...(record.example as Record<string, unknown>) };
      }
      return { ...record };
    }
    return undefined;
  }

  private extractJsonString(output: string): string | undefined {
    let text = this.stripCodeFences(output);
    if (!text) {
      return undefined;
    }
    if (this.isJsonParsable(text)) {
      return text;
    }
    return this.findJsonSubstring(text);
  }

  private stripCodeFences(text: string): string {
    let trimmed = String(text).trim();
    if (trimmed.startsWith('```')) {
      trimmed = trimmed
        .replace(/^```[a-zA-Z0-9-]*\n?/, '')
        .replace(/```$/, '')
        .trim();
    }
    return trimmed;
  }

  private isJsonParsable(text: string): boolean {
    try {
      JSON.parse(text);
      return true;
    } catch {
      return false;
    }
  }

  private findJsonSubstring(text: string): string | undefined {
    let index = 0;
    while (index < text.length) {
      const start = this.findNextJsonStart(text, index);
      if (start === -1) {
        return undefined;
      }
      const candidate = this.extractBalancedJson(text, start);
      if (candidate) {
        return candidate;
      }
      index = start + 1;
    }
    return undefined;
  }

  private findNextJsonStart(text: string, fromIndex: number): number {
    let brace = text.indexOf('{', fromIndex);
    let bracket = text.indexOf('[', fromIndex);
    if (brace === -1) return bracket;
    if (bracket === -1) return brace;
    return Math.min(brace, bracket);
  }

  private extractBalancedJson(text: string, start: number): string | undefined {
    const openChar = text[start];
    const closeChar = openChar === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escape) {
          escape = false;
        } else if (ch === '\\') {
          escape = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === openChar) {
        depth++;
      } else if (ch === closeChar) {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(start, i + 1);
          if (this.isJsonParsable(candidate)) {
            return candidate;
          }
        }
      }
    }
    return undefined;
  }

  private async createExampleInstance(
    codeRef: BaseCommandModule.CreateInstancesInput['codeRef'],
    examplePayload: Record<string, unknown>,
    realm: string | undefined,
  ): Promise<CardDef | undefined> {
    // Heuristics: LLM payloads sometimes return fully-formed JSON:API documents, or just
    // attribute blobs. We treat `attributes` as authoritative if present, otherwise look
    // at `data.attributes`, and finally fall back to the top-level keys. In all cases we
    // strip any id/relationship/meta hints to avoid collisions before persisting the new
    // instance that adopts from the resolved code ref.
    if (!codeRef?.module || !codeRef?.name) {
      return undefined;
    }
    const resolvedRef = this.resolveCodeRef(codeRef, realm);
    if (!resolvedRef) {
      return undefined;
    }

    let attributesSource: Record<string, unknown> | undefined;
    if (
      examplePayload.attributes &&
      typeof examplePayload.attributes === 'object' &&
      !Array.isArray(examplePayload.attributes)
    ) {
      attributesSource = examplePayload.attributes as Record<string, unknown>;
    } else if (
      examplePayload.data &&
      typeof examplePayload.data === 'object' &&
      !Array.isArray(examplePayload.data)
    ) {
      let dataNode = examplePayload.data as Record<string, unknown>;
      if (
        dataNode.attributes &&
        typeof dataNode.attributes === 'object' &&
        !Array.isArray(dataNode.attributes)
      ) {
        attributesSource = dataNode.attributes as Record<string, unknown>;
      } else {
        attributesSource = dataNode;
      }
    } else if (typeof examplePayload === 'object' && examplePayload) {
      attributesSource = examplePayload as Record<string, unknown>;
    }
    let attributes = attributesSource ? { ...attributesSource } : {};
    delete (attributes as any).id;
    delete (attributes as any).relationships;
    delete (attributes as any).meta;

    const doc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        attributes,
        meta: {
          adoptsFrom: resolvedRef,
        },
      },
    };
    console.debug('createExampleInstance: creating card', doc);

    const creationResult = await this.store.add(doc, {
      realm: realm ?? this.realm.defaultWritableRealm?.path,
      doNotWaitForPersist: true,
    });
    if (!isCardInstance(creationResult)) {
      console.warn('Failed to save generated example card', {
        errors: creationResult,
      });
      return undefined;
    }
    return creationResult;
  }

  private resolveCodeRef(
    codeRef: BaseCommandModule.CreateInstancesInput['codeRef'],
    realm: string | undefined,
  ): ResolvedCodeRef | undefined {
    if (isResolvedCodeRef(codeRef)) {
      return codeRef;
    }
    try {
      const relativeTo = realm ? new URL(realm) : undefined;
      const resolved = codeRefWithAbsoluteURL(
        codeRef,
        relativeTo,
      ) as ResolvedCodeRef;
      return resolved;
    } catch {
      return undefined;
    }
  }
}
