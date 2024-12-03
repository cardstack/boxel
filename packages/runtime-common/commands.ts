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
  abstract getInputType(): Promise<{ new (args: any): CardInputType }>; // TODO: can we do better than any here?

  invocations: CommandInvocation<CardInputType, CardResultType>[] = [];

  nextCompletionDeferred: Deferred<CardResultType> =
    new Deferred<CardResultType>();

  name: string = this.constructor.name;
  description = '';

  constructor(
    protected readonly commandContext: CommandContext,
    protected readonly configuration?: CommandConfiguration | undefined, // we'd like this to be required *if* CommandConfiguration is defined, and allow the user to skip it when CommandConfiguration is undefined
  ) {}

  /*
   await SaveCardCommand.runSingle({
        commandContext,
        realm: this.currentRealm.href,
        card: myAppCard,
      });
      await ShowCardCommand.runSingle({
        commandContext,
        cardToShow: myAppCard,
      });
  */
  static async runSingle<T extends Command<any, any, any>>(
    this: new (context: CommandContext) => T,
    args: { commandContext: CommandContext } & (T extends Command<
      infer I,
      any,
      any
    >
      ? Partial<Omit<I, 'constructor'>>
      : never),
  ): Promise<T extends Command<any, infer R, any> ? R : never> {
    let command = new this(args.commandContext);
    let InputType = await command.getInputType();
    let input = new InputType(args);
    return await command.execute(input);
  }

  async execute(input: CardInputType): Promise<CardResultType> {
    // internal bookkeeping
    // todo: support for this.runTask being defined
    // runTask would be an ember task, run would just be a normal function

    let invocation = new CommandInvocation<CardInputType, CardResultType>(
      input,
    );

    this.invocations.push(invocation);
    this.nextCompletionDeferred.fulfill(invocation.promise);

    try {
      let result = await this.run(input);
      invocation.fulfill(result);
      return result;
    } catch (error) {
      invocation.reject(error);
      throw error;
    } finally {
      this.nextCompletionDeferred = new Deferred<CardResultType>();
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
    let schema = generateJsonSchemaForCardType(
      InputType as unknown as typeof CardDef, // TODO: can we do better type-wise?
      cardApi,
      mappings,
    );
    console.log('Generating schema for ', this.name, InputType, schema);
    return schema;
  }
}
