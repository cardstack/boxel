// Fixes a trivial mistake in a script that failed before it did anything: a
// missing bracket, an unclosed string, a typo in a name. A script that runs
// cleanly never reaches this, so it costs nothing. One cheap model call
// proposes the corrected script; the guards below decide whether it may run.

import { serviceError, validateResolved, type ProxySend } from './research';

import type { RealmScriptErrorInfo } from './types';

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

// A small model: the fix is a few characters, and the guards check it.
export const AUTO_FIX_LLM = 'openai/gpt-4.1-mini';
// How many fixes one run may try. The second is for a first fix that still
// does not compile.
export const MAX_AUTO_FIX_ATTEMPTS = 2;
// A longer script is not sent: the model would return all of it.
export const MAX_AUTO_FIX_CODE_CHARS = 20_000;
// How much a fix may change: the lines it replaces, the lines it adds, and
// the characters that differ once the unchanged start and end are set aside.
const MAX_FIX_LINES = 5;
const MAX_FIX_CHARS = 200;

// Whether a failed run may be fixed and run again. A compile error means the
// script never ran. A ReferenceError or TypeError before the first realm.*
// call means it did nothing yet. After a realm.* call the script may have
// written, downloaded or changed the room, so it is never run again.
export function autoFixable(
  error: RealmScriptErrorInfo,
  callsMade: number,
): boolean {
  if (error.phase === 'compile') {
    return error.name === 'SyntaxError';
  }
  return (
    callsMade === 0 &&
    (error.name === 'ReferenceError' || error.name === 'TypeError')
  );
}

const FIX_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['fixedCode', 'summary'],
  properties: {
    fixedCode: { type: 'string', maxLength: MAX_AUTO_FIX_CODE_CHARS * 2 },
    summary: { type: 'string', maxLength: 200 },
  },
};

const SYSTEM_PROMPT = `You fix one trivial mistake in a JavaScript script that failed to run.
The script is the body of an async function: top-level await and return are allowed.
Change as little as possible: fix only the reported error, such as a missing bracket or semicolon, an unclosed string, a missing declaration, or a typo in a name.
Never add, remove or rename a realm.* or room.* call, and never add a URL.
Return JSON: fixedCode is the whole corrected script; summary is one short clause saying what you changed, such as "added a missing ')'".`;

export interface ProposedFix {
  code: string;
  summary: string;
  model: string;
}

export async function proposeFix(
  code: string,
  error: RealmScriptErrorInfo,
  send: ProxySend,
  signal: AbortSignal,
): Promise<ProposedFix> {
  let response: Response;
  try {
    response = await send({
      url: OPENROUTER_CHAT_URL,
      requestBody: JSON.stringify({
        model: AUTO_FIX_LLM,
        stream: false,
        temperature: 0,
        max_tokens: Math.ceil(code.length / 2) + 300,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: JSON.stringify({
              code,
              error: {
                name: error.name,
                message: error.message,
                line: error.line ?? null,
              },
            }),
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'script_fix', strict: true, schema: FIX_SCHEMA },
        },
      }),
      signal,
    });
  } catch (cause) {
    throw serviceError('OpenRouter', cause);
  }
  let body = await response.json();
  if (body?.error) {
    throw new Error(body.error.message ?? JSON.stringify(body.error));
  }
  let content = body?.choices?.[0]?.message?.content;
  let output: unknown;
  try {
    output = JSON.parse(String(content));
  } catch {
    throw new Error('the model did not answer with JSON');
  }
  validateResolved(output, FIX_SCHEMA);
  let { fixedCode, summary } = output as { fixedCode: string; summary: string };
  return {
    code: fixedCode,
    summary: summary.trim().replace(/\.$/, ''),
    model: typeof body.model === 'string' ? body.model : AUTO_FIX_LLM,
  };
}

const CALL_RE = /\b(?:realm|room)(?:\s*\.\s*[A-Za-z_$][\w$]*)+/g;
const NAME_RE = /\b(?:realm|room)\b/g;
const URL_RE = /https?:\/\/[^\s'"`)<>\\]+/g;

function matches(code: string, re: RegExp): string[] {
  return (code.match(re) ?? []).map((match) => match.replace(/\s+/g, ''));
}

// The lines a fix replaced and the lines it added, with the unchanged lines
// before and after set aside.
function changedRegion(original: string, fixed: string) {
  let a = original.split('\n');
  let b = fixed.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return { start, removed: a.slice(start, endA), added: b.slice(start, endB) };
}

// How many characters differ between two strings, with their common start
// and end set aside.
function changedChars(a: string, b: string): number {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return Math.max(endA - start, endB - start);
}

export interface CheckedFix {
  diff: string;
  // Why the fix may not run; undefined for a fix that passed every guard.
  problem?: string;
}

// The guards a fix must pass before it runs. Whether it compiles is the
// run's own check: a script that does not compile runs nothing.
export function checkFix(original: string, fixed: string): CheckedFix {
  let { start, removed, added } = changedRegion(original, fixed);
  let diff = [
    `@@ line ${start + 1} @@`,
    ...removed.map((line) => `- ${line}`),
    ...added.map((line) => `+ ${line}`),
  ].join('\n');
  if (removed.length === 0 && added.length === 0) {
    return { diff, problem: 'the fix changed nothing' };
  }
  if (removed.length > MAX_FIX_LINES || added.length > MAX_FIX_LINES) {
    return {
      diff,
      problem: `the fix changed more than ${MAX_FIX_LINES} lines`,
    };
  }
  let chars = changedChars(removed.join('\n'), added.join('\n'));
  if (chars > MAX_FIX_CHARS) {
    return {
      diff,
      problem: `the fix changed ${chars} characters, more than ${MAX_FIX_CHARS}`,
    };
  }
  let before = new Set(matches(original, CALL_RE));
  let after = new Set(matches(fixed, CALL_RE));
  let addedCalls = [...after].filter((call) => !before.has(call));
  if (addedCalls.length > 0) {
    return { diff, problem: `the fix added ${addedCalls.join(', ')}` };
  }
  let removedCalls = [...before].filter((call) => !after.has(call));
  if (removedCalls.length > 0) {
    return { diff, problem: `the fix removed ${removedCalls.join(', ')}` };
  }
  // `realm` or `room` reached another way, such as `realm['fs']`.
  if (matches(fixed, NAME_RE).length > matches(original, NAME_RE).length) {
    return { diff, problem: 'the fix added a use of realm or room' };
  }
  let urls = new Set(matches(original, URL_RE));
  let addedURLs = matches(fixed, URL_RE).filter((url) => !urls.has(url));
  if (addedURLs.length > 0) {
    return { diff, problem: `the fix added the URL ${addedURLs[0]}` };
  }
  return { diff };
}
