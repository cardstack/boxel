import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { logger } from '@cardstack/runtime-common';

const log = logger('proxy-instrument');

/**
 * Realm-server passthrough instrumentation. When
 * `FACTORY_INSTRUMENT_PATH` is set, every chat-completion request that
 * flows through the OpenRouter passthrough is summarised to a JSONL
 * file: per-request prompt sizes (system, tools, message history),
 * per-response tool-call counts, finish_reason, usage tokens, and
 * timing.
 *
 * Designed to answer the questions in
 * `packages/software-factory/OPENCODE_PERFORMANCE.md`:
 * H1 (tool_calls per assistant response), H2 (per-step prompt
 * overhead), H3 (wall-clock between steps), H4 (model identity).
 *
 * Sizes only — we do not write the actual prompt/tool/message text to
 * disk. Token counts are rough estimates (chars / 4).
 */

export interface RequestStats {
  model: string | null;
  parallelToolCalls: boolean | null;
  toolChoice: unknown;
  systemChars: number;
  systemTokensEst: number;
  toolsCount: number;
  toolsChars: number;
  toolsTokensEst: number;
  messagesCount: number;
  messagesChars: number;
  messagesTokensEst: number;
  totalInputChars: number;
  totalInputTokensEst: number;
}

export interface ResponseStats {
  toolCallsCount: number;
  toolCallNames: string[];
  assistantTextChars: number;
  finishReason: string | null;
  usagePromptTokens: number | null;
  usageCompletionTokens: number | null;
  usageTotalTokens: number | null;
  ttfbMs: number | null;
  durationMs: number;
}

export interface InstrumentationRecord {
  ts: string;
  user: string;
  endpoint: string;
  request: RequestStats;
  response: ResponseStats;
}

const TOKENS_PER_CHAR = 0.25;

const estTokens = (chars: number) => Math.round(chars * TOKENS_PER_CHAR);

const stringifyOrEmpty = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  try {
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return '';
  }
};

export function isInstrumentationEnabled(): boolean {
  return Boolean(process.env.FACTORY_INSTRUMENT_PATH);
}

export function analyzeRequest(rawBody: string): RequestStats {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    // Fall through with everything zeroed; the caller will still log
    // the timing + response side, which is most of the value.
  }

  const model = typeof parsed.model === 'string' ? parsed.model : null;
  const parallelToolCalls =
    typeof parsed.parallel_tool_calls === 'boolean'
      ? parsed.parallel_tool_calls
      : null;
  const toolChoice = parsed.tool_choice ?? null;

  const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  const tools = Array.isArray(parsed.tools) ? parsed.tools : [];

  // System prompt: chat-completions style puts it as the first
  // message with role:"system". A few callers also set a top-level
  // `system` field — sum both so we don't undercount.
  let systemChars = 0;
  let nonSystemMessages: unknown[] = [];
  for (const msg of messages) {
    const m = msg as Record<string, unknown>;
    if (m && m.role === 'system') {
      systemChars += stringifyOrEmpty(m.content).length;
    } else {
      nonSystemMessages.push(msg);
    }
  }
  if (typeof parsed.system === 'string') {
    systemChars += parsed.system.length;
  } else if (parsed.system !== undefined) {
    systemChars += stringifyOrEmpty(parsed.system).length;
  }

  const messagesChars = nonSystemMessages.reduce<number>(
    (acc, msg) => acc + stringifyOrEmpty(msg).length,
    0,
  );
  const toolsChars = tools.reduce<number>(
    (acc, tool) => acc + stringifyOrEmpty(tool).length,
    0,
  );

  const totalInputChars = systemChars + messagesChars + toolsChars;

  return {
    model,
    parallelToolCalls,
    toolChoice,
    systemChars,
    systemTokensEst: estTokens(systemChars),
    toolsCount: tools.length,
    toolsChars,
    toolsTokensEst: estTokens(toolsChars),
    messagesCount: nonSystemMessages.length,
    messagesChars,
    messagesTokensEst: estTokens(messagesChars),
    totalInputChars,
    totalInputTokensEst: estTokens(totalInputChars),
  };
}

/**
 * Aggregates streaming SSE deltas to derive ResponseStats.
 *
 * Tool-call counting: OpenAI streams tool calls as deltas with an
 * `index` field that uniquely identifies each tool slot in the final
 * assistant message. We track the set of indexes seen so we get an
 * accurate count even when individual deltas split arguments across
 * many chunks. Names are captured the first time each index reveals
 * its `function.name`.
 */
export function createResponseAnalyzer() {
  const startedAt = Date.now();
  let firstByteAt: number | null = null;
  const toolCallsByIndex = new Map<number, { name: string | null }>();
  let assistantTextChars = 0;
  let finishReason: string | null = null;
  let usagePromptTokens: number | null = null;
  let usageCompletionTokens: number | null = null;
  let usageTotalTokens: number | null = null;

  function onSSEData(data: string): void {
    if (firstByteAt === null) firstByteAt = Date.now();
    if (data === '[DONE]') return;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }

    const choices = parsed.choices;
    if (Array.isArray(choices) && choices.length > 0) {
      const c = choices[0] as Record<string, unknown>;
      if (typeof c.finish_reason === 'string') {
        finishReason = c.finish_reason;
      }
      const delta = c.delta as Record<string, unknown> | undefined;
      if (delta) {
        if (typeof delta.content === 'string') {
          assistantTextChars += delta.content.length;
        }
        const tcs = delta.tool_calls;
        if (Array.isArray(tcs)) {
          for (const tc of tcs) {
            const t = tc as Record<string, unknown>;
            const idx = typeof t.index === 'number' ? t.index : null;
            if (idx === null) continue;
            const existing = toolCallsByIndex.get(idx) ?? { name: null };
            const fn = t.function as { name?: string } | undefined;
            if (fn?.name && !existing.name) {
              existing.name = fn.name;
            }
            toolCallsByIndex.set(idx, existing);
          }
        }
      }
    }

    const usage = parsed.usage as Record<string, unknown> | undefined;
    if (usage) {
      if (typeof usage.prompt_tokens === 'number') {
        usagePromptTokens = usage.prompt_tokens;
      }
      if (typeof usage.completion_tokens === 'number') {
        usageCompletionTokens = usage.completion_tokens;
      }
      if (typeof usage.total_tokens === 'number') {
        usageTotalTokens = usage.total_tokens;
      }
    }
  }

  function finalize(): ResponseStats {
    const now = Date.now();
    const indexes = Array.from(toolCallsByIndex.keys()).sort((a, b) => a - b);
    return {
      toolCallsCount: indexes.length,
      toolCallNames: indexes.map(
        (i) => toolCallsByIndex.get(i)?.name ?? '<unknown>',
      ),
      assistantTextChars,
      finishReason,
      usagePromptTokens,
      usageCompletionTokens,
      usageTotalTokens,
      ttfbMs: firstByteAt === null ? null : firstByteAt - startedAt,
      durationMs: now - startedAt,
    };
  }

  return { onSSEData, finalize };
}

let writeChain: Promise<void> = Promise.resolve();

/**
 * Append an instrumentation record to the configured JSONL file.
 *
 * Writes are serialised through a promise chain so concurrent
 * requests can't interleave bytes mid-line. Failures are logged once
 * and don't propagate — instrumentation must never break a real
 * request.
 */
export function writeInstrumentationRecord(
  record: InstrumentationRecord,
): void {
  const target = process.env.FACTORY_INSTRUMENT_PATH;
  if (!target) return;

  const line = JSON.stringify(record) + '\n';
  writeChain = writeChain
    .then(async () => {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.appendFile(target, line, 'utf8');
    })
    .catch((err) => {
      log.warn(
        `Failed to write instrumentation record to ${target}: ${String(err)}`,
      );
    });
}
