import { isCardDef } from './code-ref';
import { Deferred } from './deferred';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import { CardDef } from 'https://cardstack.com/base/card-api';
import { SkillCard } from 'https://cardstack.com/base/skill-card';
import {
  AttributesSchema,
  CardSchema,
  generateJsonSchemaForCardType,
} from './helpers/ai';

export interface CommandContext {
  sendAiAssistantMessage: (params: {
    roomId?: string; // if falsy we create a new room
    show?: boolean; // if truthy, ensure the side panel to the room
    prompt: string;
    attachedCards?: CardDef[];
    skillCards?: SkillCard[];
    commands?: { command: Command<any, any, any>; autoExecute: boolean }[];
  }) => Promise<{ roomId: string }>;
}

export class CommandInvocation<
  CardInputType extends CardDef | undefined,
  CardResultType extends CardDef | undefined,
> {
  result?: CardResultType;
  error: Error | undefined;
  status: 'pending' | 'success' | 'error' = 'pending';
  private deferred: Deferred<CardResultType> = new Deferred<CardResultType>();

  constructor(public readonly input: CardInputType) {}

  get promise(): Promise<CardResultType> {
    return this.deferred.promise;
  }

  fulfill(result: CardResultType): void {
    this.status = 'success';
    this.deferred.fulfill(result);
  }

  reject(error: unknown): void {
    this.status = 'error';
    this.deferred.reject(error);
  }
}

export abstract class Command<
  CardInputType extends CardDef | undefined,
  CardResultType extends CardDef | undefined,
  CommandConfiguration extends any | undefined = undefined,
> {
  // Is this actually type checking ?
  abstract getInputType(): Promise<
    { new (args?: Partial<CardInputType>): CardInputType } | undefined
  >; // TODO: can we do better than any here?

  invocations: CommandInvocation<CardInputType, CardResultType>[] = [];

  nextCompletionDeferred: Deferred<CardResultType> =
    new Deferred<CardResultType>();

  name: string = this.constructor.name;
  description = '';

  constructor(
    protected readonly commandContext: CommandContext,
    protected readonly configuration?: CommandConfiguration | undefined, // we'd like this to be required *if* CommandConfiguration is defined, and allow the user to skip it when CommandConfiguration is undefined
  ) {}

  async execute(
    input: CardInputType extends CardDef | undefined
      ? CardInputType | Omit<CardInputType, keyof CardDef>
      : never,
  ): Promise<CardResultType> {
    // internal bookkeeping
    // todo: support for this.runTask being defined
    // runTask would be an ember task, run would just be a normal function

    let inputCard: CardInputType;
    if (input === undefined) {
      inputCard = undefined as CardInputType;
    } else if (isCardDef(input.constructor)) {
      inputCard = input as CardInputType;
    } else {
      let InputType = await this.getInputType();
      if (!InputType) {
        throw new Error('Input provided but no input type found');
      } else {
        inputCard = new InputType(input) as CardInputType;
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
      this.nextCompletionDeferred = new Deferred<CardResultType>();
      this.nextCompletionDeferred.promise.catch(() => {
        // ensure this is not considered an unhandled rejection by QUnit
      });
    }
  }

  protected abstract run(input: CardInputType): Promise<CardResultType>;

  waitForNextCompletion(): Promise<CardResultType> {
    return this.nextCompletionDeferred.promise;
  }

  async getInputJsonSchema(
    cardApi: typeof CardAPI,
    mappings: Map<typeof CardAPI.FieldDef, AttributesSchema>,
  ): Promise<CardSchema> {
    let InputType = await this.getInputType();
    return generateJsonSchemaForCardType(
      InputType as unknown as typeof CardDef, // TODO: can we do better type-wise?
      cardApi,
      mappings,
    );
  }
}
