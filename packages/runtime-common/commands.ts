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

export interface ToolRequest {
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

export abstract class Tool<
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

// Pre-rename spelling of `Tool`. Realm content (user command modules) extends
// this under the old name, so the alias stays for as long as such content
// exists; new code extends `Tool`.
export { Tool as Command };

function friendlyModuleName(fullModuleUrl: string) {
  return fullModuleUrl
    .split('/')
    .pop()!
    .replace(/\.gts$/, '');
}

export function buildCommandFunctionName(
  commandCodeRef: ResolvedCodeRef,
  relativeTo: RealmResourceIdentifier | URL | undefined,
  // Optional: omit to resolve the code ref in RRI space (no VirtualNetwork).
  // `functionName` is a recomputed `computeVia` field (never persisted), and
  // `buildCommandFunctionName` is its only producer, so dropping the VN keeps
  // every command name self-consistent.
  virtualNetwork?: VirtualNetwork,
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

  return buildCommandFunctionNameFromResolvedRef(absoluteCodeRef);
}

// The host tool modules were published as `@cardstack/boxel-host/commands/*`
// before the command → tool rename; both spellings resolve to the same
// modules. functionNames are minted by hashing `module#name`, so the hash
// input canonicalizes the tool-named spelling back to the pre-rename one —
// HASH INPUT ONLY, never resolution. This keeps every functionName ever
// minted byte-identical across the rename: definitions persisted in room
// state, names referenced in matrix history, and refs authored under either
// spelling all agree without any re-upload or migration. Tools that never
// had a pre-rename spelling also hash through this mapping, which is
// harmless — the mapped string is just a stable seed.
const HOST_TOOLS_MODULE_PREFIX = '@cardstack/boxel-host/tools/';
const HOST_COMMANDS_MODULE_PREFIX = '@cardstack/boxel-host/commands/';

export function moduleForFunctionNameHash(module: string): string {
  if (module.startsWith(HOST_TOOLS_MODULE_PREFIX)) {
    return `${HOST_COMMANDS_MODULE_PREFIX}${module.slice(
      HOST_TOOLS_MODULE_PREFIX.length,
    )}`;
  }
  return module;
}

// The name-construction half of buildCommandFunctionName, for callers that
// already hold an absolute code ref (registered package prefixes resolve
// verbatim, so e.g. ai-bot can produce identical names without a
// VirtualNetwork).
export function buildCommandFunctionNameFromResolvedRef(ref: {
  module: string;
  name: string;
}): string {
  if (!ref?.module || !ref?.name) {
    return '';
  }
  const hashed = simpleHash(
    `${moduleForFunctionNameHash(ref.module)}#${ref.name}`,
  );
  let name = ref.name === 'default' ? friendlyModuleName(ref.module) : ref.name;
  return `${name}_${hashed.slice(0, 4)}`;
}

export function decodeCommandRequest(
  commandRequest: Partial<EncodedCommandRequest>,
): Partial<ToolRequest> {
  if (typeof commandRequest.arguments === 'object') {
    // backwards compatibility for older format
    return commandRequest as Partial<ToolRequest>;
  }
  let decodedCommandRequest: Partial<ToolRequest> = {};
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
  commandRequest: Partial<ToolRequest>,
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
  commandRequests: Partial<ToolRequest>[],
): Partial<EncodedCommandRequest>[] {
  return commandRequests.map(encodeCommandRequest);
}

// Pre-rename spelling; new code imports `ToolRequest`.
export type CommandRequest = ToolRequest;
