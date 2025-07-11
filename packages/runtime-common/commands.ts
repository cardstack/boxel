import {
  type ResolvedCodeRef,
  isCardDef,
  codeRefWithAbsoluteURL,
} from './code-ref';
import { Deferred } from './deferred';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import { CardDefConstructor } from 'https://cardstack.com/base/card-api';
import {
  AttributesSchema,
  CardSchema,
  generateJsonSchemaForCardType,
} from './helpers/ai';
import { simpleHash } from './utils';
import { EncodedCommandRequest } from '../base/matrix-event';

export interface CommandRequest {
  id: string;
  name: string;
  arguments: { [key: string]: any };
}

export const CommandContextStamp = Symbol.for('CommandContext');
export interface CommandContext {
  [CommandContextStamp]: boolean;
}

export class CommandInvocation<
  CardInputType extends CardDefConstructor | undefined,
  CardResultType extends CardDefConstructor | undefined = undefined,
> {
  result?: CardInstance<CardResultType>;
  error: Error | undefined;
  status: 'pending' | 'success' | 'error' = 'pending';
  private deferred: Deferred<CardInstance<CardResultType>> = new Deferred<
    CardInstance<CardResultType>
  >();

  constructor(public readonly input: CardInstance<CardInputType>) {}

  get promise(): Promise<CardInstance<CardResultType>> {
    return this.deferred.promise;
  }

  fulfill(result: CardInstance<CardResultType>): void {
    this.status = 'success';
    this.deferred.fulfill(result);
  }

  reject(error: unknown): void {
    this.status = 'error';
    this.deferred.reject(error);
  }
}

type FieldsOf<T> = { [K in keyof Omit<T, 'constructor'>]: T[K] };

type CardInstance<T extends CardDefConstructor | undefined> =
  T extends CardDefConstructor ? InstanceType<T> : undefined;

export abstract class Command<
  CardInputType extends CardDefConstructor | undefined,
  CardResultType extends CardDefConstructor | undefined = undefined,
> {
  static actionVerb = 'Apply';

  abstract getInputType(): Promise<CardInputType>;

  name: string = this.constructor.name;
  description = '';

  constructor(protected readonly commandContext: CommandContext) {}

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
    return generateJsonSchemaForCardType(InputType, cardApi, mappings);
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
  relativeTo?: URL,
) {
  if (!commandCodeRef?.module || !commandCodeRef?.name) {
    return '';
  }
  let absoluteCodeRef = codeRefWithAbsoluteURL(
    commandCodeRef,
    relativeTo,
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
  return encodedCommandRequest;
}

export function encodeCommandRequests(
  commandRequests: Partial<CommandRequest>[],
): Partial<EncodedCommandRequest>[] {
  return commandRequests.map(encodeCommandRequest);
}
