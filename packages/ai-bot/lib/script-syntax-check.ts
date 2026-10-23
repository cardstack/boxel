import vm from 'node:vm';
import type { ChatCompletionMessageToolCall } from 'openai/resources';
import type {
  ChatCompletionMessageToolCall as PromptToolCall,
  OpenAIPromptMessage,
} from '@cardstack/runtime-common/ai';
import {
  describeScriptError,
  REALM_RUNNER_SCRIPT_FILE_NAME,
  wrapRealmRunnerScript,
} from '@cardstack/runtime-common/realm-runner-script';
import { parseLenientJson } from './lenient-json.ts';

// A run-realm-code script that doesn't parse fails in the host before any of
// it runs, and the user sees the failed call with a Retry button that runs the
// same script again. Most often a file's content inside a template literal
// holds a backtick that ends the string early. So ai-bot parses each script
// before the answer is finished, and hands a script that doesn't parse back to
// the model in the same turn, where the user never sees it. Only parsing: the
// script never runs here.

// How many times one turn hands unparseable scripts back to the model. After
// that the answer is finished as it is, so the user sees the error and the
// model can't loop without end.
export const MAX_SCRIPT_SYNTAX_RETRIES = 2;

// Host tools reach the model under their name with a hash suffix
// (`run-realm-code_6b92`).
const RUN_REALM_CODE_TOOL_NAME = /^run-realm-code(_\w+)?$/;

export function isRunRealmCodeToolName(name: string | undefined): boolean {
  return !!name && RUN_REALM_CODE_TOOL_NAME.test(name);
}

// The message the host worker would give for a script that doesn't parse, or
// undefined when it parses. V8 and QuickJS can differ on edge cases; a script
// V8 accepts and QuickJS rejects only fails in the host as it does without
// this check.
export function scriptSyntaxError(code: string): string | undefined {
  try {
    new vm.Script(wrapRealmRunnerScript(code), {
      filename: REALM_RUNNER_SCRIPT_FILE_NAME,
    });
    return undefined;
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      return undefined;
    }
    // V8 puts the location on the first line of the stack:
    // `realm-code.js:3`.
    let location = new RegExp(
      `^${REALM_RUNNER_SCRIPT_FILE_NAME.replace('.', '\\.')}:(\\d+)`,
    ).exec(error.stack ?? '');
    return describeScriptError(
      {
        name: error.name,
        message: error.message,
        lineNumber: location ? Number(location[1]) : undefined,
      },
      code,
    );
  }
}

function codeOf(call: PromptToolCall): string | undefined {
  if (!isRunRealmCodeToolName(call.function.name)) {
    return undefined;
  }
  try {
    let args = parseLenientJson(call.function.arguments) as {
      attributes?: { code?: unknown };
    };
    let code = args?.attributes?.code;
    return typeof code === 'string' ? code : undefined;
  } catch {
    // Arguments that aren't JSON fail in the host with their own message.
    return undefined;
  }
}

// The messages that hand a reply's unparseable scripts back to the model: the
// reply itself, then a result for each of its calls. None of the reply's calls
// runs, so every call gets a result saying so. Undefined when every script in
// the reply parses. `toolCalls` carry the ids they are posted with, which are
// unique in the room.
export function scriptSyntaxRetryMessages(
  content: string | null | undefined,
  replyToolCalls: ChatCompletionMessageToolCall[],
): OpenAIPromptMessage[] | undefined {
  // Function calls are the only kind of call the bot offers tools for.
  let toolCalls: PromptToolCall[] = replyToolCalls.flatMap((call) =>
    call.type === 'function'
      ? [
          {
            id: call.id,
            type: 'function' as const,
            function: {
              name: call.function.name,
              arguments: call.function.arguments,
            },
          },
        ]
      : [],
  );
  let errors = new Map<string, string>();
  for (let call of toolCalls) {
    let code = codeOf(call);
    let error = code === undefined ? undefined : scriptSyntaxError(code);
    if (error) {
      errors.set(call.id, error);
    }
  }
  if (errors.size === 0) {
    return undefined;
  }
  return [
    { role: 'assistant', content: content ?? '', tool_calls: toolCalls },
    ...toolCalls.map(
      (call): OpenAIPromptMessage => ({
        role: 'tool',
        tool_call_id: call.id,
        content: errors.has(call.id)
          ? `Tool call not run: the script does not parse, so none of it ran and no file was saved.\n${errors.get(call.id)}\nFix the script and call the tool again.\n`
          : 'Tool call not run: another script in this answer does not parse, so none of its calls ran. Make this call again if it is still needed.\n',
      }),
    ),
  ];
}
