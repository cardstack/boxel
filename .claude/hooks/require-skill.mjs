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
import { readFileSync, readdirSync, statSync } from 'node:fs';
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
// and any boxel-catalog pull request may need a pair, so creating or editing
// one counts too. gh takes its repository flag before or after `pr`, and
// `new` is an alias of `create`.
const GH_REPO_FLAG = String.raw`(?:\s+(?:-R|--repo)(?:=|\s+)\S+)*`;
const GH_PR = new RegExp(
  String.raw`\bgh${GH_REPO_FLAG}\s+pr${GH_REPO_FLAG}\s+(?:create|new|edit)\b`,
);
// The same, through the GitHub MCP server's pull request tools.
const MCP_PR_TOOLS = new Set([
  'mcp__github__create_pull_request',
  'mcp__github__update_pull_request',
]);
const PAIRING_KEY = /merges\s+(before|after)\s*:/i;
const BODY_FILE = /(?:--body-file[=\s]+|-F\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/;
// The command names the catalog repository: a repository flag in any form, a
// GH_REPO, or a cd into a checkout of it.
const NAMES_CATALOG = /\bboxel-catalog\b/;

function bodyFileText(command, cwd) {
  let match = BODY_FILE.exec(command);
  let file = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!file || file === '-') {
    return '';
  }
  let path = isAbsolute(file) || !cwd ? file : join(cwd, file);
  try {
    // Only a regular file: a FIFO would block the read until the hook times
    // out.
    return statSync(path).isFile() ? readFileSync(path, 'utf8') : '';
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

// A pull request review posted from the shell or the GitHub MCP tools: a
// review, or an inline comment in one. A reply in a thread isn't one: it
// continues a review that already ran the lens, or answers one. Neither is a
// top-level comment, which pr-review never posts a review as; requiring the
// lens for one would cost every "rebased" note on a UI pull request.
const GH_PR_REVIEW = new RegExp(
  String.raw`\bgh${GH_REPO_FLAG}\s+pr${GH_REPO_FLAG}\s+review\b`,
);
// gh pr review flags that take a value.
const GH_VALUE_FLAGS = new Set([
  '-b',
  '--body',
  '-F',
  '--body-file',
  '-R',
  '--repo',
]);
const GH_API_REVIEW =
  /\bgh\s+api\b.*?\brepos\/([^/\s'"]+\/[^/\s'"]+)\/pulls\/(\d+)\/(?:reviews|comments)\b(\/\d+\/replies)?/;
const GH_API_WRITES =
  /(?:^|\s)(?:-f|-F|--field|--raw-field|--input)(?:=|\s)|(?:^|\s)(?:-X|--method)(?:=|\s*)['"]?post\b/i;
const GH_GRAPHQL = /\bgh\s+api\s+graphql\b/;
const GRAPHQL_REVIEW =
  /\b(?:addPullRequestReview|addPullRequestReviewComment|addPullRequestReviewThread|submitPullRequestReview)\b/;
// The pull request, review, thread or comment a review mutation names.
const REVIEW_NODE_ID = /\b(?:PR|PRR|PRRT|PRRC)_[A-Za-z0-9_-]+/;
const MCP_REVIEW_TOOLS = new Set([
  'mcp__github__pull_request_review_write',
  'mcp__github__add_comment_to_pending_review',
]);
// What ui-lens.md calls a UI change, by file type. Tests aren't one.
const UI_FILE = /\.(gts|hbs|css)$/;
const TEST_FILE = /(^|\/)tests?\/|[.-]test\.gts$/;

// The words of a shell command up to the end of its first command, unquoted.
// Enough to read flags and arguments; not a shell parser.
function shellWords(text) {
  let words = [];
  let word = null;
  for (let i = 0; i < text.length; i++) {
    let c = text[i];
    if (c === "'") {
      let end = text.indexOf("'", i + 1);
      end = end < 0 ? text.length : end;
      word = (word ?? '') + text.slice(i + 1, end);
      i = end;
    } else if (c === '"') {
      let j = i + 1;
      let quoted = '';
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\' && j + 1 < text.length) {
          j++;
        }
        quoted += text[j++];
      }
      word = (word ?? '') + quoted;
      i = j;
    } else if (c === '\\' && i + 1 < text.length) {
      word = (word ?? '') + text[++i];
    } else if (/[;&|\n<>]/.test(c)) {
      // A redirect ends the arguments too; the `2` of `2>&1` isn't one.
      if (/[<>]/.test(c) && word !== null && /^\d+$/.test(word)) {
        word = null;
      }
      break;
    } else if (/\s/.test(c)) {
      if (word !== null) {
        words.push(word);
        word = null;
      }
    } else {
      word = (word ?? '') + c;
    }
  }
  if (word !== null) {
    words.push(word);
  }
  return words;
}

// The command with every quoted string and heredoc body blanked out, at the
// same offsets, so a pattern that matches it matches code the shell runs.
function unquoted(command) {
  let out = '';
  let i = 0;
  let blank = (text) => text.replace(/[^\n]/g, ' ');
  // Heredocs opened on the current line, whose bodies start after it.
  let pending = [];
  while (i < command.length) {
    let c = command[i];
    if (c === '\n' && pending.length) {
      let at = i + 1;
      for (let { strip, word } of pending) {
        let delimiter = new RegExp(`^${strip ? '\\t*' : ''}${word}$`);
        while (at < command.length) {
          let next = command.indexOf('\n', at);
          let lineEnd = next < 0 ? command.length : next;
          let done = delimiter.test(command.slice(at, lineEnd));
          at = lineEnd + 1;
          if (done) {
            break;
          }
        }
      }
      let end = Math.min(at, command.length);
      out += '\n' + blank(command.slice(i + 1, end));
      pending = [];
      i = end;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < command.length && command[j] !== c) {
        j += c === '"' && command[j] === '\\' ? 2 : 1;
      }
      j = Math.min(j, command.length - 1);
      out += c + blank(command.slice(i + 1, j)) + command.slice(j, j + 1);
      i = j + 1;
      continue;
    }
    let heredoc = /^<<(-?)\s*(['"]?)(\w+)\2/.exec(command.slice(i));
    if (heredoc) {
      pending.push({ strip: Boolean(heredoc[1]), word: heredoc[3] });
      out += heredoc[0];
      i += heredoc[0].length;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// The directory and GH_REPO a gh call at `index` runs with: the last `cd`
// before it and an inline GH_REPO=, which the hook's own cwd doesn't see.
function shellContext(command, index, cwd) {
  let prefix = command.slice(0, index);
  let dir = cwd;
  for (let [, double, single, bare] of prefix.matchAll(
    /(?:^|[;&|\s(])cd\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|)]+))/g,
  )) {
    let path = (double ?? single ?? bare).replace(
      /^~(?=\/|$)/,
      process.env.HOME ?? '~',
    );
    dir = isAbsolute(path) || !dir ? path : join(dir, path);
  }
  let repo = /\bGH_REPO=(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/.exec(prefix);
  return { cwd: dir, repo: repo?.[1] ?? repo?.[2] ?? repo?.[3] };
}

// gh's `{owner}/{repo}` placeholders mean the current repository, which the
// call's directory already gives.
function literalRepo(repo) {
  return repo && !repo.includes('{') ? repo : undefined;
}

function reviewTarget({ tool_name, tool_input, cwd }) {
  if (MCP_REVIEW_TOOLS.has(tool_name)) {
    let { owner, repo, pullNumber } = tool_input ?? {};
    return {
      cwd,
      selector: pullNumber ? String(pullNumber) : undefined,
      repo: owner && repo ? `${owner}/${repo}` : undefined,
    };
  }
  if (tool_name !== 'Bash') {
    return undefined;
  }
  let command = tool_input?.command ?? '';
  // Only a gh that runs counts; one quoted in a body or a fixture doesn't.
  // Its path, query and flags are still read from the command as written.
  let code = unquoted(command);
  let ghApi = /\bgh\s+api\b/.exec(code);
  let api = ghApi && GH_API_REVIEW.exec(command.slice(ghApi.index));
  if (api && GH_API_WRITES.test(command)) {
    if (api[3] || /\bin_reply_to\b/.test(command)) {
      return undefined;
    }
    let context = shellContext(command, ghApi.index, cwd);
    return {
      cwd: context.cwd,
      selector: api[2],
      repo: literalRepo(api[1]) ?? context.repo,
    };
  }
  let graphql = GH_GRAPHQL.exec(code);
  if (graphql && GRAPHQL_REVIEW.test(command)) {
    let nodeId = REVIEW_NODE_ID.exec(command)?.[0];
    return nodeId
      ? { cwd: shellContext(command, graphql.index, cwd).cwd, nodeId }
      : undefined;
  }
  let review = GH_PR_REVIEW.exec(code);
  if (review) {
    let context = shellContext(command, review.index, cwd);
    let repo = /(?:-R|--repo)(?:=|\s+)(\S+)/.exec(review[0])?.[1];
    let selector;
    let words = shellWords(command.slice(review.index + review[0].length));
    for (let i = 0; i < words.length; i++) {
      let word = words[i];
      if (word === '-R' || word === '--repo') {
        repo = words[i + 1];
      } else if (word.startsWith('--repo=')) {
        repo = word.slice('--repo='.length);
      }
      if (!word.startsWith('-')) {
        selector ??= word;
      } else if (GH_VALUE_FLAGS.has(word)) {
        i++;
      }
    }
    return { cwd: context.cwd, selector, repo: repo ?? context.repo };
  }
  return undefined;
}

const NODE_PULL_REQUEST = `query($id: ID!) { node(id: $id) {
  ... on PullRequest { number repository { nameWithOwner } }
  ... on PullRequestReview { pullRequest { number repository { nameWithOwner } } }
  ... on PullRequestReviewThread { pullRequest { number repository { nameWithOwner } } }
  ... on PullRequestReviewComment { pullRequest { number repository { nameWithOwner } } }
} }`;

function gh(args, cwd) {
  return execFileSync('gh', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 15000,
  });
}

// The UI files the reviewed pull request changes. Every UI-lens rule asks,
// so the diff is read once. A pull request or diff that can't be read allows
// the review rather than refusing every one.
let uiFiles;
function changedUIFiles(input) {
  if (uiFiles) {
    return uiFiles;
  }
  uiFiles = [];
  let target = reviewTarget(input);
  if (!target) {
    return uiFiles;
  }
  try {
    if (target.nodeId) {
      let [repo, number] = gh(
        [
          'api',
          'graphql',
          '-f',
          `query=${NODE_PULL_REQUEST}`,
          '-f',
          `id=${target.nodeId}`,
          '--jq',
          '.data.node | (.pullRequest // .) | "\\(.repository.nameWithOwner) \\(.number)"',
        ],
        target.cwd,
      )
        .trim()
        .split(' ');
      target = { ...target, repo, selector: number };
    }
    let args = ['pr', 'diff', '--name-only'];
    if (target.selector) {
      args.push(target.selector);
    }
    if (target.repo) {
      args.push('--repo', target.repo);
    }
    uiFiles = gh(args, target.cwd)
      .split('\n')
      .map((file) => file.trim())
      .filter((file) => UI_FILE.test(file) && !TEST_FILE.test(file));
  } catch {
    uiFiles = [];
  }
  return uiFiles;
}

// ui-lens.md lets a review go ahead without a skill that can't be loaded, so
// a rule asks only for skills in this session's skill listing, which the
// transcript records. A listing that can't be read lists nothing.
let listed;
function canLoad(input, skill) {
  if (!listed) {
    listed = new Set();
    let texts = [];
    try {
      texts.push(readFileSync(input.transcript_path, 'utf8'));
      if (input.agent_id) {
        texts.push(readTranscript(input) ?? '');
      }
    } catch {
      // Whatever was read still counts.
    }
    for (let line of texts.join('\n').split('\n')) {
      if (!line.includes('"skill_listing"')) {
        continue;
      }
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      let content = entry?.attachment?.content;
      if (
        entry?.attachment?.type !== 'skill_listing' ||
        typeof content !== 'string'
      ) {
        continue;
      }
      for (let [, name] of content.matchAll(/^- (\S+?):?(?:\s|$)/gm)) {
        listed.add(name);
      }
    }
  }
  return listed.has(skill);
}

// `load` is the name the Skill tool loads the skill by. A `.gts`-only rule
// applies when the change has a `.gts` file.
function uiLensRule(load, { gtsOnly = false } = {}) {
  return {
    skill: load.split(':').pop(),
    load,
    why: 'A review of a UI change runs the UI lens in .claude/skills/pr-review/references/ui-lens.md, which loads these skills and runs them in full.',
    matches(input) {
      let files = changedUIFiles(input);
      if (!files.length) {
        return false;
      }
      if (gtsOnly && !files.some((file) => file.endsWith('.gts'))) {
        return false;
      }
      return canLoad(input, load) && 'posting a review of a UI change';
    },
  };
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
          /^boxel-catalog$/i.test(tool_input?.repo ?? '') &&
          'opening or editing a boxel-catalog pull request'
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
      if (NAMES_CATALOG.test(command) || inCatalogCheckout(cwd)) {
        return 'opening or editing a boxel-catalog pull request';
      }
      return false;
    },
  },
  uiLensRule('gts-component-conventions', { gtsOnly: true }),
  uiLensRule('boxel-skills:boxel-ui-guidelines'),
  // better-interface, then each of its domains in its order.
  ...[
    'better-interface',
    'better-accessibility',
    'better-layout',
    'better-writing',
    'better-typography',
    'better-colors',
    'better-ui',
  ].map((skill) => uiLensRule(`interfaces:${skill}`)),
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
let whys = new Set();
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
        `Load it with the Skill tool (skill: "${rule.load ?? rule.skill}"), follow it, then retry.`,
    );
    whys.add(rule.why);
  }
}

if (refusals.length) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: [...refusals, ...whys].join(' '),
      },
    }),
  );
}
