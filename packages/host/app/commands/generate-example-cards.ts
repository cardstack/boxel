import { service } from '@ember/service';

import {
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
import {
  buildAttachedFileURLs,
  buildExamplePrompt,
  ONE_SHOT_SYSTEM_PROMPT,
  parseExamplePayloadFromOutput,
} from './example-card-helpers';
export { AskAiForCardJsonCommand } from './ask-ai-for-card-json';

import type AiAssistantPanelService from '../services/ai-assistant-panel-service';
import type CardService from '../services/card-service';
import type MatrixService from '../services/matrix-service';
import type RealmService from '../services/realm';
import type StoreService from '../services/store';

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

    const commandModule = await this.loadCommandModule();
    const { CreateInstanceResult } = commandModule;
    return new CreateInstanceResult({ createdCard });
  }
}

export class CreateExampleCardCommand extends HostBaseCommand<
  typeof BaseCommandModule.CreateExampleCardInput,
  typeof BaseCommandModule.CreateInstanceResult
> {
  @service declare private store: StoreService;
  @service declare private realm: RealmService;

  static actionVerb = 'Create Example Card';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CreateExampleCardInput } = commandModule;
    return CreateExampleCardInput;
  }

  protected async run(
    input: BaseCommandModule.CreateExampleCardInput,
  ): Promise<BaseCommandModule.CreateInstanceResult> {
    if (!input.codeRef) {
      throw new Error('codeRef is required to create a card');
    }
    const realm = input.realm || this.realm.defaultWritableRealm?.path;
    if (!realm) {
      throw new Error('realm is required to create a card');
    }

    let examplePayload = input.payload;
    if (!examplePayload || typeof examplePayload !== 'object') {
      throw new Error('payload is required to create a card');
    }

    const createdCard = await createExampleInstanceFromPayload({
      codeRef: input.codeRef,
      examplePayload: examplePayload as Record<string, unknown>,
      realm,
      store: this.store,
      defaultRealm: this.realm.defaultWritableRealm?.path,
      localDir: input.localDir ?? null,
    });

    if (!createdCard) {
      throw new Error('Failed to create example card');
    }

    let commandModule = await this.loadCommandModule();
    const { CreateInstanceResult } = commandModule;
    return new CreateInstanceResult({
      createdCard,
    });
  }
}

async function createExampleInstanceFromPayload(opts: {
  codeRef: BaseCommandModule.CreateInstancesInput['codeRef'];
  examplePayload: Record<string, unknown>;
  realm: string | undefined;
  store: StoreService;
  defaultRealm?: string;
  localDir?: string | null;
}): Promise<CardDef | undefined> {
  if (!opts.codeRef?.module || !opts.codeRef?.name) {
    return undefined;
  }
  const resolvedRef = resolveExampleCodeRef(opts.codeRef, opts.realm);
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
  console.debug('createExampleInstance: creating card', doc);

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
