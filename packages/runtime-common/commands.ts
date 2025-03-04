import { isCardDef } from './code-ref';
import { Deferred } from './deferred';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import { CardDefConstructor } from 'https://cardstack.com/base/card-api';
import {
  AttributesSchema,
  CardSchema,
  generateJsonSchemaForCardType,
} from './helpers/ai';

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
  abstract getInputType(): Promise<CardInputType>;

  invocations: CommandInvocation<CardInputType, CardResultType>[] = [];

  nextCompletionDeferred: Deferred<CardInstance<CardResultType>> = new Deferred<
    CardInstance<CardResultType>
  >();

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
    // internal bookkeeping
    // todo: support for this.runTask being defined
    // runTask would be an ember task, run would just be a normal function

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
    let invocation = new CommandInvocation<CardInputType, CardResultType>(
      inputCard,
    );

    this.invocations.push(invocation);
    this.nextCompletionDeferred.fulfill(invocation.promise);

    try {
      let result = await this.run(inputCard);
      invocation.fulfill(result);
      return result;
    } catch (error) {
      invocation.reject(error);
      throw error;
    } finally {
      this.nextCompletionDeferred = new Deferred<
        CardInstance<CardResultType>
      >();
      this.nextCompletionDeferred.promise.catch(() => {
        // ensure this is not considered an unhandled rejection by QUnit
      });
    }
  }

  protected abstract run(
    input: CardInstance<CardInputType>,
  ): Promise<CardInstance<CardResultType>>;

  waitForNextCompletion(): Promise<CardInstance<CardResultType>> {
    return this.nextCompletionDeferred.promise;
  }

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
