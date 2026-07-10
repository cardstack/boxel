import { service } from '@ember/service';

import {
  isCardInstance,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import {
  codeRefWithAbsoluteIdentifier,
  isResolvedCodeRef,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common/code-ref';

import {
  buildAttachedFileURLs,
  buildExamplePrompt,
  ONE_SHOT_SYSTEM_PROMPT,
  parseExamplePayloadFromOutput,
} from '../lib/example-card-helpers';
import HostBaseTool from '../lib/host-base-tool';

import { prettifyPrompts } from '../utils/prettify-prompts';

import OneShotLlmRequestTool from './one-shot-llm-request';
import SendAiAssistantMessageTool from './send-ai-assistant-message';

import type AiAssistantPanelService from '../services/ai-assistant-panel-service';
import type CardService from '../services/card-service';
import type MatrixService from '../services/matrix-service';
import type NetworkService from '../services/network';
import type RealmService from '../services/realm';
import type StoreService from '../services/store';
import type { CardDef } from '@cardstack/base/card-api';
import type * as BaseToolModule from '@cardstack/base/command';

export default class GenerateExampleCardsTool extends HostBaseTool<
  typeof BaseToolModule.CreateInstancesInput,
  undefined
> {
  @service declare private aiAssistantPanelService: AiAssistantPanelService;
  @service declare private matrixService: MatrixService;
  @service declare private realm: RealmService;

  static actionVerb = 'Generate Example Cards';
  description = 'Create new cards populated with sample data';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { CreateInstancesInput } = commandModule;
    return CreateInstancesInput;
  }

  protected getPrompt(count: number) {
    return `Generate ${count} additional instances of the specified card definition, populated with sample data.`;
  }

  protected getAttachedFileURLs(input: BaseToolModule.CreateInstancesInput) {
    return buildAttachedFileURLs(input.codeRef?.module);
  }

  protected async run(
    input: BaseToolModule.CreateInstancesInput,
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

    let sendMessageCommand = new SendAiAssistantMessageTool(
      this.commandContext,
    );

    await sendMessageCommand.execute({
      roomId: this.matrixService.currentRoomId,
      prompt: userPrompt,
      attachedCards: input.exampleCard ? [input.exampleCard] : [],
      attachedFileIdentifiers: this.getAttachedFileURLs(input),
      realmIdentifier: realm,
    });
  }
}

export class GenerateExampleCardsOneShotTool extends HostBaseTool<
  typeof BaseToolModule.CreateInstancesInput,
  typeof BaseToolModule.CreateInstanceResult
> {
  @service declare private realm: RealmService;
  @service declare private store: StoreService;
  @service declare private network: NetworkService;
  @service declare private cardService: CardService;

  static actionVerb = 'Generate Example (One-shot)';

  description =
    'Create a new card instance populated with sample data via a direct LLM request';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { CreateInstancesInput } = commandModule;
    return CreateInstancesInput;
  }

  protected async run(
    input: BaseToolModule.CreateInstancesInput,
  ): Promise<BaseToolModule.CreateInstanceResult> {
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

    const oneShot = new OneShotLlmRequestTool(this.commandContext);
    const attachedFileIdentifiers = buildAttachedFileURLs(input.codeRef.module);
    const llmResult = await oneShot.execute({
      codeRef: input.codeRef,
      systemPrompt: ONE_SHOT_SYSTEM_PROMPT,
      userPrompt,
      llmModel: 'anthropic/claude-3-haiku',
      attachedFileIdentifiers:
        attachedFileIdentifiers.length > 0
          ? attachedFileIdentifiers
          : undefined,
    });

    const { payload: examplePayload } = parseExamplePayloadFromOutput(
      llmResult.output,
    );
    if (!examplePayload) {
      throw new Error('LLM did not return a valid JSON example payload');
    }
    const createdCard = await createExampleInstanceFromPayload({
      codeRef: input.codeRef,
      examplePayload,
      realm,
      store: this.store,
      network: this.network,
      defaultRealm: this.realm.defaultWritableRealm?.path,
      localDir: undefined,
    }).catch((error) => {
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

    const commandModule = await this.loadToolModule();
    const { CreateInstanceResult } = commandModule;
    return new CreateInstanceResult({ createdCard });
  }
}

export async function createExampleInstanceFromPayload(opts: {
  codeRef: BaseToolModule.CreateInstancesInput['codeRef'];
  examplePayload: Record<string, unknown>;
  realm: string | undefined;
  store: StoreService;
  network: NetworkService;
  defaultRealm?: string;
  localDir?: string | null;
}): Promise<CardDef | undefined> {
  if (!opts.codeRef?.module || !opts.codeRef?.name) {
    return undefined;
  }
  const resolvedRef = resolveExampleCodeRef(
    opts.codeRef,
    opts.realm,
    opts.network,
  );
  if (!resolvedRef) {
    return undefined;
  }

  const attributes = normalizeExampleAttributes(opts.examplePayload);

  const doc: LooseSingleCardDocument = {
    data: {
      type: 'card',
      attributes,
      meta: {
        adoptsFrom: resolvedRef,
      },
    },
  };

  const creationResult = await opts.store.add(doc, {
    realm: opts.realm ?? opts.defaultRealm,
    localDir: opts.localDir ?? undefined,
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

function normalizeExampleAttributes(
  examplePayload: Record<string, unknown>,
): Record<string, unknown> {
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
  return attributes;
}

function resolveExampleCodeRef(
  codeRef: BaseToolModule.CreateInstancesInput['codeRef'],
  realm: string | undefined,
  network: NetworkService,
): ResolvedCodeRef | undefined {
  if (isResolvedCodeRef(codeRef)) {
    return codeRef;
  }
  try {
    const relativeTo = realm ? new URL(realm) : undefined;
    const resolved = codeRefWithAbsoluteIdentifier(
      codeRef,
      relativeTo,
      undefined,
      network.virtualNetwork,
    ) as ResolvedCodeRef;
    return resolved;
  } catch {
    return undefined;
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { GenerateExampleCardsTool as GenerateExampleCardsCommand };
export { GenerateExampleCardsOneShotTool as GenerateExampleCardsOneShotCommand };
