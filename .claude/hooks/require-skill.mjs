#!/usr/bin/env node
// PreToolUse hook: refuses a tool call that needs a skill until the session
// has loaded that skill. Some procedures go wrong in ways no check catches
// in time — a catalog pin that only exists in a local checkout, a generated
// copy edited in place — so the skill that describes them is required
// reading, not a suggestion.
//
// Each rule names a skill and says which tool calls need it. A call that
// matches a rule is allowed once the session transcript shows the skill was
// loaded (through the Skill tool or its slash command), and refused with the
// skill's name otherwise. A call no rule matches never reads the transcript.
//
// The hook fails open: input it can't parse, or a transcript it can't read,
// allows the call rather than wedging the session.

import { readFileSync } from 'node:fs';

const MANIFEST = /(^|\/)packages\/catalog\/test-subset\.json$/;
const MANIFEST_IN_COMMAND = /test-subset\.json/;
// Shell forms that rewrite a file in place, redirect into it, or replace it.
const SHELL_WRITE =
  /\bsed\b[^\n;&|]*\s(-[a-zA-Z]*i\b|--in-place)|\bperl\b[^\n;&|]*\s-[a-zA-Z]*i|\btee\b[^\n;&|]*test-subset\.json|>\s*["']?[^\s;&|]*test-subset\.json|\b(mv|cp)\b[^\n;&|]*test-subset\.json|\bgit\s+(checkout|restore)\b[^\n;&|]*test-subset\.json/;
const BUMP = /(catalog:test-subset|sync-test-subset\.ts)\b[^\n;&|]*--bump\b/;
const LOCAL_SOURCE = /\bCATALOG_TEST_SUBSET_SOURCE=/;

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

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
        let command = tool_input?.command ?? '';
        if (BUMP.test(command)) {
          return 're-pinning the catalog test subset with --bump';
        }
        if (LOCAL_SOURCE.test(command)) {
          return 'serving the catalog test subset from a local checkout';
        }
        if (MANIFEST_IN_COMMAND.test(command) && SHELL_WRITE.test(command)) {
          return 'writing packages/catalog/test-subset.json from the shell';
        }
      }
      return false;
    },
  },
];

// The skill's own text opens with "Base directory for this skill: <dir>",
// whether the Skill tool or the slash command loaded it, and <dir> ends in
// the skill's name. A worktree-scoped copy of the skill ends the same way.
// The transcript is JSON lines, so the newline after <dir> is the two
// characters backslash and n.
function loaded(transcript, skill) {
  return new RegExp(
    `Base directory for this skill: [^\\s"\\\\]*/${skill}(\\\\n|")`,
  ).test(transcript);
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
      transcript = readFileSync(input.transcript_path, 'utf8');
    } catch {
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
