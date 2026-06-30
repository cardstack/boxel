import {
  type ResolvedCodeRef,
  isCardDef,
  codeRefWithAbsoluteIdentifier,
} from './code-ref.ts';
import type { RealmResourceIdentifier } from './realm-identifiers.ts';
import type { VirtualNetwork } from './virtual-network.ts';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type { CardDefConstructor } from 'https://cardstack.com/base/card-api';
import type { AttributesSchema, CardSchema } from './helpers/ai.ts';
import { generateJsonSchemaForCardType } from './helpers/ai.ts';
import { simpleHash } from './utils.ts';
import type { EncodedCommandRequest } from '../base/matrix-event.gts';

// `executedBy` value for tool calls ai-bot runs itself in-process (e.g.
// readRealmFile).
export const AI_BOT_EXECUTOR = 'ai-bot';

export interface CommandRequest {
  id: string;
  name: string;
  arguments: { [key: string]: any };
  // Names the actor that ran (or will run) this tool call — e.g. AI_BOT_EXECUTOR
  // for tools ai-bot executes itself. It's a value (not a boolean) so it can
  // identify *which* actor in a multi-bot / multi-user room, and so the field
  // can later carry e.g. 'host' too. The host therefore matches its own
  // executor explicitly rather than treating any value as "not mine to run".
  executedBy?: string;
}

export const CommandContextStamp = Symbol.for('CommandContext');
export interface CommandContext {
  [CommandContextStamp]: boolean;
}

export interface CommandInvocation<CardResultType extends CardDefConstructor> {
  cardResult: CardInstance<CardResultType> | null;
  error: Error | null;
  status: 'pending' | 'success' | 'error';
  readonly isSuccess: boolean;
  readonly isLoading: boolean;
}

export type FieldsOf<T> = { [K in keyof Omit<T, 'constructor'>]: T[K] };

export type CardInstance<T extends CardDefConstructor | undefined> =
  T extends CardDefConstructor ? InstanceType<T> : undefined;

export abstract class Command<
  CardInputType extends CardDefConstructor | undefined,
  CardResultType extends CardDefConstructor | undefined = undefined,
> {
  static actionVerb = 'Apply';

  abstract getInputType(): Promise<CardInputType>;

  ignoreInputFields: string[] = ['cardInfo'];
  requireInputFields: string[] = [];

  name: string = this.constructor.name;
  description = '';

  protected readonly commandContext: CommandContext;

  constructor(commandContext: CommandContext) {
    this.commandContext = commandContext;
  }

  async execute(): Promise<CardInstance<CardResultType>>;
  async execute(
    input: CardInputType extends CardDefConstructor
      ? Partial<FieldsOf<CardInstance<CardInputType>>>
      : never,
  ): Promise<CardInstance<CardResultType>>;
  async execute(
    input?: CardInputType extends CardDefConstructor
      ? Partial<FieldsOf<CardInstance<CardInputType>>>
      : never,
  ): Promise<CardInstance<CardResultType>> {
    let inputCard: CardInstance<CardInputType>;
    if (input === undefined) {
      inputCard = undefined as CardInstance<CardInputType>;
    } else if (isCardDef(input.constructor)) {
      inputCard = input as unknown as CardInstance<CardInputType>;
    } else {
      let InputType = await this.getInputType();
      if (!InputType) {
        throw new Error('Input provided but no input type found');
      } else {
        inputCard = new InputType(input) as CardInstance<CardInputType>;
      }
    }
    return this.run(inputCard);
  }

  protected abstract run(
    input: CardInstance<CardInputType>,
  ): Promise<CardInstance<CardResultType>>;

  async getInputJsonSchema(
    cardApi: typeof CardAPI,
    mappings: Map<typeof CardAPI.FieldDef, AttributesSchema>,
    strict = false,
  ): Promise<CardSchema> {
    let InputType = await this.getInputType();
    if (!InputType) {
      return {
        attributes: {
          type: 'object',
          properties: {},
        },
        relationships: {
          type: 'object',
          properties: {},
        },
      };
    }
    return generateJsonSchemaForCardType(InputType, cardApi, mappings, {
      require: this.requireInputFields,
      ignore: this.ignoreInputFields,
      strict,
    });
  }
}

function friendlyModuleName(fullModuleUrl: string) {
  return fullModuleUrl
    .split('/')
    .pop()!
    .replace(/\.gts$/, '');
}

export function buildCommandFunctionName(
  commandCodeRef: ResolvedCodeRef,
  relativeTo: RealmResourceIdentifier | URL | undefined,
  virtualNetwork: VirtualNetwork,
) {
  if (!commandCodeRef?.module || !commandCodeRef?.name) {
    return '';
  }
  let absoluteCodeRef = codeRefWithAbsoluteIdentifier(
    commandCodeRef,
    relativeTo,
    undefined,
    virtualNetwork,
  ) as ResolvedCodeRef;

  const hashed = simpleHash(
    `${absoluteCodeRef.module}#${absoluteCodeRef.name}`,
  );
  let name =
    absoluteCodeRef.name === 'default'
      ? friendlyModuleName(absoluteCodeRef.module)
      : absoluteCodeRef.name;
  return `${name}_${hashed.slice(0, 4)}`;
}

export function decodeCommandRequest(
  commandRequest: Partial<EncodedCommandRequest>,
): Partial<CommandRequest> {
  if (typeof commandRequest.arguments === 'object') {
    // backwards compatibility for older format
    return commandRequest as Partial<CommandRequest>;
  }
  let decodedCommandRequest: Partial<CommandRequest> = {};
  if (commandRequest.id) {
    decodedCommandRequest.id = commandRequest.id;
  }
  if (commandRequest.name) {
    decodedCommandRequest.name = commandRequest.name;
  }
  if (commandRequest.arguments) {
    decodedCommandRequest.arguments = JSON.parse(commandRequest.arguments);
    try {
      let attributes = decodedCommandRequest.arguments?.attributes;
      if (typeof attributes === 'string') {
        decodedCommandRequest.arguments!.attributes = JSON.parse(attributes);
      }
    } catch {
      // ignore malformed nested json; validation will report a clearer error later
    }
  }
  if (commandRequest.executedBy != null) {
    decodedCommandRequest.executedBy = commandRequest.executedBy;
  }
  return decodedCommandRequest;
}

export function encodeCommandRequest(
  commandRequest: Partial<CommandRequest>,
): Partial<EncodedCommandRequest> {
  if (typeof commandRequest.arguments === 'string') {
    // backwards compatibility for older format
    return commandRequest as Partial<EncodedCommandRequest>;
  }
  let encodedCommandRequest: Partial<EncodedCommandRequest> = {};
  if (commandRequest.id) {
    encodedCommandRequest.id = commandRequest.id;
  }
  if (commandRequest.name) {
    encodedCommandRequest.name = commandRequest.name;
  }
  if (commandRequest.arguments) {
    encodedCommandRequest.arguments = JSON.stringify(commandRequest.arguments);
  }
  if (commandRequest.executedBy != null) {
    encodedCommandRequest.executedBy = commandRequest.executedBy;
  }
  return encodedCommandRequest;
}

export function encodeCommandRequests(
  commandRequests: Partial<CommandRequest>[],
): Partial<EncodedCommandRequest>[] {
  return commandRequests.map(encodeCommandRequest);
}
