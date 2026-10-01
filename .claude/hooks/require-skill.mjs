#!/usr/bin/env node
// PreToolUse hook: refuses a tool call that needs a skill until the session
// has loaded that skill. Some procedures go wrong in ways no check catches
// in time — a catalog pin that only exists in a local checkout, a generated
// copy edited in place — so the skill that describes them is required
// reading, not a suggestion.
//
// Each rule names a skill and says which tool calls need it. A call that
// matches a rule is allowed once the transcript of the session or subagent
// making it shows the skill was loaded (through the Skill tool or its slash
// command), and refused with the skill's name otherwise. A call no rule
// matches never reads a transcript. Rules err toward matching: a needless
// refusal costs one skill load, and a miss is the mistake the rule exists for.
//
// The hook fails open: input it can't parse, or a transcript it can't find or
// read, allows the call rather than wedging the session.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';

const MANIFEST = /(^|\/)packages\/catalog\/test-subset\.json$/;
// Any shell command that names the manifest, the sync that writes from it, or
// the variable that swaps what the sync reads. However the command touches
// them (an interpreter one-liner, a continued line, a redirect), it is pin
// work.
const PIN_IN_COMMAND =
  /test-subset\.json|catalog:test-subset|sync-test-subset|CATALOG_TEST_SUBSET_SOURCE/;

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

// A pull request created or edited from the shell or the GitHub MCP tools.
// Its description pairs it with a pull request in the other repository when it
// has a `Merges before:` or `Merges after:` line, inline or in a --body-file;
// and any boxel-catalog pull request may need a pair, so creating one counts
// too.
const GH_PR = /\bgh\s+pr\s+(create|edit)\b/;
const GH_PR_CREATE = /\bgh\s+pr\s+create\b/;
// The same, through the GitHub MCP server's pull request tools.
const MCP_PR_TOOLS = new Set([
  'mcp__github__create_pull_request',
  'mcp__github__update_pull_request',
]);
const PAIRING_KEY = /merges\s+(before|after)\s*:/i;
const BODY_FILE = /(?:--body-file[=\s]+|-F\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/;
const CATALOG_REPO_FLAG =
  /(?:--repo[=\s]+|-R\s*)['"]?(?:https:\/\/github\.com\/)?cardstack\/boxel-catalog\b/;

function bodyFileText(command, cwd) {
  let match = BODY_FILE.exec(command);
  let file = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!file || file === '-') {
    return '';
  }
  let path = isAbsolute(file) || !cwd ? file : join(cwd, file);
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : '';
  } catch {
    return '';
  }
}

function inCatalogCheckout(cwd) {
  if (!cwd) {
    return false;
  }
  try {
    let remote = execFileSync(
      'git',
      ['-C', cwd, 'remote', 'get-url', 'origin'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    return /cardstack\/boxel-catalog(\.git)?\s*$/.test(remote);
  } catch {
    return false;
  }
}

const rules = [
  {
    skill: 'catalog-test-subset',
    why: 'It says how to move the catalog test subset pin for local tests, for a commit you can push, and for merge.',
    matches({ tool_name, tool_input }) {
      if (EDIT_TOOLS.has(tool_name)) {
        let path = tool_input?.file_path ?? tool_input?.notebook_path ?? '';
        return (
          MANIFEST.test(path) && 'editing packages/catalog/test-subset.json'
        );
      }
      if (tool_name === 'Bash') {
        return (
          PIN_IN_COMMAND.test(tool_input?.command ?? '') &&
          'a shell command on the catalog test subset pin'
        );
      }
      return false;
    },
  },
  {
    skill: 'catalog-pairing',
    why: 'It says when a boxel and a boxel-catalog pull request must be paired, how to declare the pair in both descriptions, and which merges first.',
    matches({ tool_name, tool_input, cwd }) {
      if (MCP_PR_TOOLS.has(tool_name)) {
        if (PAIRING_KEY.test(tool_input?.body ?? '')) {
          return 'a pull request description with a pairing line';
        }
        return (
          tool_name === 'mcp__github__create_pull_request' &&
          /^boxel-catalog$/i.test(tool_input?.repo ?? '') &&
          'opening a boxel-catalog pull request'
        );
      }
      if (tool_name !== 'Bash') {
        return false;
      }
      let command = tool_input?.command ?? '';
      if (!GH_PR.test(command)) {
        return false;
      }
      if (
        PAIRING_KEY.test(command) ||
        PAIRING_KEY.test(bodyFileText(command, cwd))
      ) {
        return 'a pull request description with a pairing line';
      }
      if (
        GH_PR_CREATE.test(command) &&
        (CATALOG_REPO_FLAG.test(command) || inCatalogCheckout(cwd))
      ) {
        return 'opening a boxel-catalog pull request';
      }
      return false;
    },
  },
];

// A loaded skill is a user message whose text block opens with "Base
// directory for this skill: <dir>", whether the Skill tool or the slash
// command loaded it, and <dir> ends in the skill's name (a worktree-scoped
// copy ends the same way). Tool output that happens to print the phrase isn't
// a text block, so it doesn't count.
function loaded(transcript, skill) {
  for (let line of transcript.split('\n')) {
    if (!line.includes('Base directory for this skill: ')) {
      continue;
    }
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type !== 'user') {
      continue;
    }
    let content = entry.message?.content;
    let blocks =
      typeof content === 'string'
        ? [{ type: 'text', text: content }]
        : Array.isArray(content)
          ? content
          : [];
    for (let block of blocks) {
      if (block?.type !== 'text' || typeof block.text !== 'string') {
        continue;
      }
      let first = block.text.split('\n', 1)[0];
      if (
        first.startsWith('Base directory for this skill: ') &&
        first.endsWith(`/${skill}`)
      ) {
        return true;
      }
    }
  }
  return false;
}

// Every hook call gets the main session's transcript_path, including calls a
// subagent makes; those also carry agent_id, and the subagent's own messages,
// its skill loads among them, are written to
// <session dir>/<session id>/subagents/**/agent-<agent_id>.jsonl. A subagent
// has to load the skill itself, except a fork, which inherits the main
// session's context.
function readTranscript(input) {
  if (!input.agent_id) {
    return readFileSync(input.transcript_path, 'utf8');
  }
  let dir = join(
    dirname(input.transcript_path),
    input.session_id ?? basename(input.transcript_path, '.jsonl'),
    'subagents',
  );
  let own = readdirSync(dir, { recursive: true }).find(
    (file) => basename(String(file)) === `agent-${input.agent_id}.jsonl`,
  );
  if (!own) {
    return undefined;
  }
  let transcript = readFileSync(join(dir, String(own)), 'utf8');
  if (input.agent_type === 'fork') {
    transcript += '\n' + readFileSync(input.transcript_path, 'utf8');
  }
  return transcript;
}

let input;
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}

let refusals = [];
let transcript;
for (let rule of rules) {
  let action = rule.matches(input);
  if (!action) {
    continue;
  }
  if (transcript === undefined) {
    try {
      transcript = readTranscript(input);
    } catch {
      transcript = undefined;
    }
    if (transcript === undefined) {
      process.exit(0);
    }
  }
  if (!loaded(transcript, rule.skill)) {
    refusals.push(
      `${action} needs the \`${rule.skill}\` skill, which this session hasn't loaded. ` +
        `Load it with the Skill tool (skill: "${rule.skill}"), follow it, then retry. ${rule.why}`,
    );
  }
}

if (refusals.length) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: refusals.join(' '),
      },
    }),
  );
}
