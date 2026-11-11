// Runs the hook as Claude Code does: a child process fed the PreToolUse input
// on stdin, with a transcript on disk and a stub gh on PATH. Most of the hook
// is shell parsing (continuations, quoting, heredocs, comments, compound
// commands), so most cases are a command and the decision it should get.
//   node --test .claude/hooks/require-skill.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'require-skill.mjs');

// gh answers the calls the hook makes from the environment, and logs each.
const GH_STUB = `#!/bin/sh
printf '%s\\n' "$*" >> "$GH_STUB_LOG"
case "$*" in
  "pr diff --name-only"*) printf '%s\\n' "$GH_STUB_FILES" ;;
  *"PullRequestReview { body }"*) printf '%s\\n' "$GH_STUB_PENDING" ;;
  "api graphql"*) printf '%s\\n' "$GH_STUB_NODE" ;;
  "api"*"/reviews"*) printf '%s\\n' "$GH_STUB_PENDING" ;;
esac
`;

const LENS_SKILLS = [
  'gts-component-conventions',
  'boxel-skills:boxel-ui-guidelines',
  'interfaces:better-interface',
  'interfaces:better-accessibility',
  'interfaces:better-layout',
  'interfaces:better-writing',
  'interfaces:better-typography',
  'interfaces:better-colors',
  'interfaces:better-ui',
];
const INTERFACES = LENS_SKILLS.filter((skill) =>
  skill.startsWith('interfaces:'),
);
const UI_FILES = ['packages/host/app/components/foo.gts'];
const DIFF_CALL = 'pr diff --name-only 7024 --repo cardstack/boxel';

// Transcript lines, as Claude Code writes them.
function listing(skills) {
  return {
    type: 'attachment',
    attachment: {
      type: 'skill_listing',
      content: skills.map((skill) => `- ${skill}: what it does`).join('\n'),
    },
  };
}
function loadedSkill(skill) {
  let name = skill.split(':').pop();
  return {
    type: 'user',
    message: {
      content: [
        {
          type: 'text',
          text: `Base directory for this skill: /plugins/skills/${name}\n# ${name}`,
        },
      ],
    },
  };
}
function readFile(path) {
  return {
    type: 'assistant',
    message: {
      content: [{ type: 'tool_use', name: 'Read', input: { file_path: path } }],
    },
  };
}
function writeTranscript(path, entries) {
  writeFileSync(
    path,
    entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
  );
}

// A directory with the stub gh, a transcript and an empty gh log.
function fixture(transcript) {
  let dir = mkdtempSync(join(tmpdir(), 'require-skill-'));
  writeFileSync(join(dir, 'gh'), GH_STUB);
  chmodSync(join(dir, 'gh'), 0o755);
  writeFileSync(join(dir, 'gh.log'), '');
  if (transcript) {
    writeTranscript(join(dir, 'session.jsonl'), transcript);
  }
  return dir;
}

// The hook's decision on `input` (an object, or raw stdin), run in `dir`.
function invoke(dir, input, { files = UI_FILES, pending = '' } = {}) {
  let result = spawnSync(process.execPath, [HOOK], {
    input:
      typeof input === 'string'
        ? input
        : JSON.stringify({
            hook_event_name: 'PreToolUse',
            session_id: 'session',
            transcript_path: join(dir, 'session.jsonl'),
            cwd: dir,
            ...input,
          }),
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      GH_STUB_LOG: join(dir, 'gh.log'),
      GH_STUB_FILES: files.join('\n'),
      GH_STUB_PENDING: pending,
      GH_STUB_NODE: 'cardstack/boxel 7024',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  let output = result.stdout.trim()
    ? JSON.parse(result.stdout).hookSpecificOutput
    : undefined;
  return {
    decision: output?.permissionDecision ?? 'allow',
    reason: output?.permissionDecisionReason ?? '',
    gh: readFileSync(join(dir, 'gh.log'), 'utf8').trim().split('\n'),
  };
}

function run(
  toolInput,
  { toolName = 'Bash', transcript = [], ...options } = {},
) {
  return invoke(
    fixture(transcript),
    { tool_name: toolName, tool_input: toolInput },
    options,
  );
}

function bash(command, options) {
  return run({ command }, options);
}

// Every lens skill is in the listing and none is loaded, so any call that
// posts a review of a UI change is refused.
const UNLOADED = [listing(LENS_SKILLS)];

test('a review call is refused until the lens skills are loaded', () => {
  let cases = [
    ['gh pr review 7024 --approve -b "ok"', 'deny'],
    ['gh -R cardstack/boxel pr review 7024 --comment -b x', 'deny'],
    ['gh pr review 7024 \\\n  --comment \\\n  -b "x"', 'deny'],
    ['gh pr view 7024 --json title && gh pr review 7024 --approve', 'deny'],
    ['gh pr review 7024 --approve # later', 'deny'],
    ["gh pr review 7024 --comment --body-file - <<'EOF'\nok\nEOF", 'deny'],
    [
      'gh api repos/cardstack/boxel/pulls/7024/comments -f body=x -f commit_id=abc -f path=a.gts -F line=1',
      'deny',
    ],
    ['gh api repos/cardstack/boxel/pulls/7024/reviews -f body=x', 'deny'],
    // A reply path in the body doesn't make a new comment a reply.
    [
      "gh api repos/cardstack/boxel/pulls/7024/comments -f body='see /pulls/7024/comments/5/replies' -f commit_id=abc -f path=a.gts -F line=1",
      'deny',
    ],
    [
      "gh api repos/cardstack/boxel/pulls/7024/comments -f body='no in_reply_to here' -f commit_id=abc -f path=a.gts -F line=1",
      'deny',
    ],
    [
      'gh api -X POST repos/cardstack/boxel/pulls/7024/comments/1/repliesX -f body=x',
      'deny',
    ],
    // Only a new comment can be a reply by its in_reply_to field.
    [
      'gh api repos/cardstack/boxel/pulls/7024/reviews -f event=COMMENT -f body=x -F in_reply_to=1',
      'deny',
    ],
    // Only digits or a shell variable name a comment to reply to.
    [
      'gh api -X POST repos/cardstack/boxel/pulls/7024/comments/?x=/replies -f body=x -f commit_id=abc -f path=a.gts -F line=1',
      'deny',
    ],
    [
      'gh api -X POST repos/cardstack/boxel/pulls/7024/comments/abc/replies -f body=x',
      'deny',
    ],
    [
      'gh api -X POST repos/cardstack/boxel/pulls/7024/reviews/$id/replies -f body=x',
      'deny',
    ],
    // Only the endpoint argument counts, not a path in a body before it.
    [
      "gh api -f body='see repos/cardstack/boxel/pulls/7024/comments/$id/replies' repos/cardstack/boxel/pulls/7024/comments -f commit_id=abc -f path=a.gts -F line=1",
      'deny',
    ],
    [
      "gh api -f body='see repos/cardstack/boxel/pulls/7024/comments/5/replies' repos/cardstack/boxel/pulls/7024/comments -f commit_id=abc -f path=a.gts -F line=1",
      'deny',
    ],
    [
      "gh api -H 'Accept: application/vnd.github+json' --method=POST /repos/cardstack/boxel/pulls/7024/reviews -f body=x",
      'deny',
    ],
    // A short-flag cluster ending in a flag that takes a value.
    [
      'gh api -iX POST repos/cardstack/boxel/pulls/7024/reviews -f body=x',
      'deny',
    ],
    [
      "gh api -iH 'Accept: application/json' repos/cardstack/boxel/pulls/7024/reviews -f event=COMMENT -f body=x",
      'deny',
    ],
    [
      'gh api -iXPOST repos/cardstack/boxel/pulls/7024/reviews -f body=x',
      'deny',
    ],
    [
      'gh api https://api.github.com/repos/cardstack/boxel/pulls/7024/reviews -f body=x',
      'deny',
    ],
    [
      'gh api -X POST "$API/repos/cardstack/boxel/pulls/7024/reviews" -f body=x -f event=COMMENT',
      'deny',
    ],
    [
      'gh api -X POST "${API}repos/cardstack/boxel/pulls/7024/reviews" -f body=x -f event=COMMENT',
      'deny',
    ],
    // An expansion or a redirect before the endpoint doesn't hide it.
    [
      'gh api $GH_FLAGS repos/cardstack/boxel/pulls/7024/reviews -f body=x -f event=COMMENT',
      'deny',
    ],
    [
      'gh api 2>/dev/null repos/cardstack/boxel/pulls/7024/reviews -f body=x -f event=COMMENT',
      'deny',
    ],
    [
      'gh api repos/cardstack/boxel/pulls/7024/reviews > out.json -f body=x -f event=COMMENT',
      'deny',
    ],
    // A command substitution is one word, even with a space or pipe in it.
    [
      'gh api -f body=$(cat f) repos/cardstack/boxel/pulls/7024/reviews -f event=COMMENT',
      'deny',
    ],
    [
      'gh api -f body=$(head -1 f | tr a b) repos/cardstack/boxel/pulls/7024/reviews -f event=COMMENT',
      'deny',
    ],
    // The method and fields come from the flags, not from a body.
    [
      "gh api repos/cardstack/boxel/pulls/7024/reviews -f event=COMMENT -f body='run it with -X GET first'",
      'deny',
    ],
    [
      'gh api -fbody=x -fevent=COMMENT repos/cardstack/boxel/pulls/7024/reviews',
      'deny',
    ],
    [
      'gh api -X=POST repos/cardstack/boxel/pulls/7024/reviews -f body=x',
      'deny',
    ],
    [
      `gh api graphql -f query='mutation { addPullRequestReview(input: {pullRequestId: "PR_kwDOAbcdef1234", body: "ok"}) { clientMutationId } }'`,
      'deny',
    ],
    // Not a review: a quoted or commented gh, a top-level comment, a reply,
    // a read.
    ['echo "gh pr review 7024 --approve" > notes.txt', 'allow'],
    ['# gh pr review 7024 --approve\nls', 'allow'],
    ['gh pr comment 7024 -b "rebased"', 'allow'],
    [
      'gh api repos/cardstack/boxel/pulls/7024/comments/1/replies -f body=x',
      'allow',
    ],
    [
      'gh api repos/cardstack/boxel/pulls/7024/comments -f body=x -F in_reply_to=1',
      'allow',
    ],
    // A reply whose comment ID is a shell variable, as in a helper that
    // answers several threads.
    [
      'gh api -X POST repos/cardstack/boxel/pulls/7024/comments/$1/replies -f body=x',
      'allow',
    ],
    [
      'r() { gh api -X POST "repos/cardstack/boxel/pulls/7024/comments/${id}/replies" -f body="$2"; }; r 1 x',
      'allow',
    ],
    [
      'gh api -X POST repos/cardstack/boxel/pulls/7024/comments/"$id"/replies -f body=x',
      'allow',
    ],
    [
      'gh api -X POST repos/cardstack/boxel/pulls/7024/comments/1${suffix}/replies -f body=x',
      'allow',
    ],
    ['gh api repos/cardstack/boxel/pulls/7024/reviews', 'allow'],
    [
      'gh api -iX GET repos/cardstack/boxel/pulls/7024/reviews -f per_page=1',
      'allow',
    ],
  ];
  for (let [command, expected] of cases) {
    assert.equal(
      bash(command, { transcript: UNLOADED }).decision,
      expected,
      command,
    );
  }
});

test('a cd before gh moves where the diff is read from', () => {
  let dir = fixture(UNLOADED);
  mkdirSync(join(dir, 'packages', 'host'), { recursive: true });
  let { decision } = invoke(dir, {
    tool_name: 'Bash',
    tool_input: { command: 'cd packages/host; gh pr review 7024 --approve' },
  });
  assert.equal(decision, 'deny');
});

test('the refusal names each skill and how to load it', () => {
  let { reason } = bash('gh pr review 7024 --approve', {
    transcript: UNLOADED,
  });
  assert.match(reason, /`gts-component-conventions` skill/);
  assert.match(reason, /skill: "boxel-skills:boxel-ui-guidelines"/);
  assert.match(reason, /skill: "interfaces:better-ui"/);
});

test('the repository flag reaches gh from either position', () => {
  for (let command of [
    'gh -R cardstack/boxel pr review 7024 --approve',
    'gh pr review --repo=cardstack/boxel 7024 --approve',
    'gh pr review 7024 --approve -R "cardstack/boxel"',
    'GH_REPO=cardstack/boxel gh pr review 7024 --approve',
  ]) {
    let { gh } = bash(command, { transcript: UNLOADED });
    assert.ok(gh.includes(DIFF_CALL), `${command}\n${gh.join('\n')}`);
  }
});

test('a GraphQL node is resolved to its pull request', () => {
  let { gh } = bash(
    `gh api graphql -f query='mutation { submitPullRequestReview(input: {pullRequestReviewId: "PRR_kwDOAbcdef1234", event: COMMENT}) { clientMutationId } }'`,
    { transcript: UNLOADED },
  );
  assert.ok(gh.some((call) => call.startsWith('api graphql')));
  assert.ok(gh.includes(DIFF_CALL));
});

test('a change with no UI file, or only test files, needs no lens', () => {
  for (let files of [
    ['packages/host/app/services/foo.ts', 'README.md'],
    [
      'packages/host/tests/acceptance/foo-test.gts',
      'packages/host/tests/x.css',
    ],
    [],
  ]) {
    let { decision } = bash('gh pr review 7024 --approve', {
      transcript: UNLOADED,
      files,
    });
    assert.equal(decision, 'allow', files.join(','));
  }
});

test('gts-component-conventions applies only to a .gts change', () => {
  let { reason } = bash('gh pr review 7024 --approve', {
    transcript: UNLOADED,
    files: ['packages/host/app/styles/a.css'],
  });
  assert.doesNotMatch(reason, /gts-component-conventions/);
  assert.match(reason, /boxel-ui-guidelines/);
});

test('a review is allowed once every lens skill is loaded', () => {
  let transcript = [listing(LENS_SKILLS), ...LENS_SKILLS.map(loadedSkill)];
  assert.equal(
    bash('gh pr review 7024 --approve', { transcript }).decision,
    'allow',
  );
});

test('the MCP review tools are gated the same way', () => {
  let base = { owner: 'cardstack', repo: 'boxel', pullNumber: 7024 };
  let cases = [
    [
      'mcp__github__pull_request_review_write',
      { ...base, method: 'create' },
      'deny',
    ],
    [
      'mcp__github__add_comment_to_pending_review',
      { ...base, body: 'x' },
      'deny',
    ],
    [
      'mcp__github__pull_request_review_write',
      { ...base, method: 'delete_pending' },
      'allow',
    ],
  ];
  for (let [toolName, toolInput, expected] of cases) {
    let { decision, gh } = run(toolInput, { toolName, transcript: UNLOADED });
    assert.equal(decision, expected, toolInput.method ?? toolName);
    if (expected === 'deny') {
      assert.ok(gh.includes(DIFF_CALL));
    }
  }
});

test('the hook fails open', () => {
  let dir = fixture();
  assert.equal(
    invoke(dir, {
      tool_name: 'Bash',
      tool_input: { command: 'gh pr review 7024 --approve' },
    }).decision,
    'allow',
    'no transcript',
  );
  assert.equal(invoke(dir, 'not json').decision, 'allow', 'bad stdin');
});

// Only gts-component-conventions can be loaded, and it is. The other lens
// skills can't, so a review that publishes has to say so in its body.
const CANT_LOAD = [
  listing(['gts-component-conventions', 'pr-review']),
  loadedSkill('gts-component-conventions'),
];
const SAID = "`boxel-ui-guidelines` and `better-interface` weren't reviewed.";

test("a published review has to say which lens skills weren't reviewed", () => {
  let cases = [
    [`gh pr review 7024 --comment -b "${SAID}"`, 'allow'],
    ['gh pr review 7024 --comment -b "Looks fine."', 'deny'],
    [
      `gh pr review 7024 --comment --body-file - <<'EOF'\n${SAID}\n\nDetails.\nEOF`,
      'allow',
    ],
    [
      "gh pr review 7024 --comment --body-file - <<'EOF'\nLooks fine.\nEOF",
      'deny',
    ],
    [
      'gh pr review 7024 --comment --body "boxel-ui-guidelines was skipped; better-interface did not run."',
      'allow',
    ],
    // One skill said to have run, the other not.
    [
      'gh pr review 7024 --comment -b "Ran boxel-ui-guidelines in full. better-interface wasn\'t reviewed."',
      'deny',
    ],
    // Nobody sees a pending review until it's submitted.
    [
      'gh api repos/cardstack/boxel/pulls/7024/reviews -f body="Looks fine."',
      'allow',
    ],
    [
      'gh api repos/cardstack/boxel/pulls/7024/reviews -f body="Looks fine." -f event=COMMENT',
      'deny',
    ],
    [
      `gh api repos/cardstack/boxel/pulls/7024/reviews -f body="${SAID}" -f event=COMMENT`,
      'allow',
    ],
    // The body is read from the review, not from replies posted before it.
    [
      'for id in 1 2; do gh api -X POST repos/cardstack/boxel/pulls/7024/comments/$id/replies -f body=done; done; gh api repos/cardstack/boxel/pulls/7024/reviews -f body="Looks fine." -f event=COMMENT',
      'deny',
    ],
    [
      `for id in 1 2; do gh api -X POST repos/cardstack/boxel/pulls/7024/comments/$id/replies -f body=done; done; gh api repos/cardstack/boxel/pulls/7024/reviews -f body="${SAID}" -f event=COMMENT`,
      'allow',
    ],
    [
      `gh api repos/cardstack/boxel/pulls/7024/comments/1/replies -F body=@- <<'A'\ndone\nA\ngh api repos/cardstack/boxel/pulls/7024/reviews -f event=COMMENT -F body=@- <<'B'\n${SAID}\nB`,
      'allow',
    ],
    [
      `gh api repos/cardstack/boxel/pulls/7024/comments/1/replies -F body=@- <<'A'\n${SAID}\nA\ngh api repos/cardstack/boxel/pulls/7024/reviews -f event=COMMENT -F body=@- <<'B'\nLooks fine.\nB`,
      'deny',
    ],
    // A heredoc piped into the call is its input.
    [
      `cat <<'B' | gh api repos/cardstack/boxel/pulls/7024/reviews -f event=COMMENT -F body=@-\n${SAID}\nB`,
      'allow',
    ],
    [`cat <<'B' | gh pr review 7024 --comment -F -\n${SAID}\nB`, 'allow'],
    [
      `cat <<'B' |& gh api repos/cardstack/boxel/pulls/7024/reviews -f event=COMMENT -F body=@-\n${SAID}\nB`,
      'allow',
    ],
    // A GraphQL review's body is read from its own call, not a reply after it.
    [
      `gh api graphql -f query='mutation { addPullRequestReview(input: {pullRequestId: "PR_kwDOAbcdef1234", event: COMMENT}) { clientMutationId } }'; gh api repos/cardstack/boxel/pulls/7024/comments/1/replies -f body='body: "boxel-ui-guidelines and better-interface were not reviewed."'`,
      'deny',
    ],
    // A heredoc fed to a group the call is in is its input too.
    [
      `{ gh api repos/cardstack/boxel/pulls/7024/reviews -f event=COMMENT -F body=@-; } <<'B'\n${SAID}\nB`,
      'allow',
    ],
    [`{ gh pr review 7024 --comment -F -; } <<'B'\n${SAID}\nB`, 'allow'],
    // The & of a redirect doesn't end the command.
    [
      `cat <<'B' 2>&1 | gh api repos/cardstack/boxel/pulls/7024/reviews -f event=COMMENT -F body=@-\n${SAID}\nB`,
      'allow',
    ],
    [
      `gh api repos/cardstack/boxel/pulls/7024/reviews -f event=COMMENT -F body=@- 2>&1 <<'B'\n${SAID}\nB`,
      'allow',
    ],
    [
      `gh pr review 7024 --comment -b "${SAID}"; gh api repos/cardstack/boxel/pulls/7024/reviews -f body="Looks fine." -f event=COMMENT`,
      'deny',
    ],
    // An inline comment outside a review, or an edit, publishes at once.
    [
      'gh api repos/cardstack/boxel/pulls/7024/comments -f body=x -f commit_id=abc -f path=a.gts -F line=1',
      'deny',
    ],
    [
      'gh api -X PATCH repos/cardstack/boxel/pulls/7024/reviews/55 -f body="Looks fine."',
      'deny',
    ],
  ];
  for (let [command, expected] of cases) {
    assert.equal(
      bash(command, { transcript: CANT_LOAD }).decision,
      expected,
      command,
    );
  }
});

test('the refusal says which skill is missing and how to install it', () => {
  let { reason } = bash('gh pr review 7024 --comment -b "Looks fine."', {
    transcript: CANT_LOAD,
  });
  assert.match(reason, /can't load `boxel-ui-guidelines`/);
  assert.match(reason, /claude plugin install boxel-skills@cardstack-boxel/);
  assert.match(reason, /can't load `better-interface`/);
  assert.match(reason, /claude plugin install interfaces@interfaces/);
  assert.match(reason, /Only when it can't be installed here/);
  assert.doesNotMatch(reason, /better-layout/);
});

test('submitting a pending review reads its body from GitHub', () => {
  let command =
    'gh api -X POST repos/cardstack/boxel/pulls/7024/reviews/55/events -f event=COMMENT';
  assert.equal(
    bash(command, { transcript: CANT_LOAD, pending: SAID }).decision,
    'allow',
  );
  assert.equal(
    bash(command, { transcript: CANT_LOAD, pending: 'Looks fine.' }).decision,
    'deny',
  );
  let submit = {
    owner: 'cardstack',
    repo: 'boxel',
    pullNumber: 7024,
    method: 'submit_pending',
    event: 'COMMENT',
  };
  let toolName = 'mcp__github__pull_request_review_write';
  assert.equal(
    run(submit, { toolName, transcript: CANT_LOAD, pending: SAID }).decision,
    'allow',
  );
  assert.equal(
    run(submit, { toolName, transcript: CANT_LOAD, pending: '' }).decision,
    'deny',
  );
});

test('a body read from a file or a JSON payload counts', () => {
  let dir = fixture(CANT_LOAD);
  writeFileSync(join(dir, 'review.md'), `${SAID}\n`);
  writeFileSync(
    join(dir, 'review.json'),
    JSON.stringify({ body: SAID, event: 'COMMENT' }),
  );
  let cases = [
    ['gh pr review 7024 --comment --body-file review.md', 'allow'],
    [
      'gh api repos/cardstack/boxel/pulls/7024/reviews -f event=COMMENT -F body=@review.md',
      'allow',
    ],
    [
      'gh api repos/cardstack/boxel/pulls/7024/reviews --input review.json',
      'allow',
    ],
    [
      `gh api repos/cardstack/boxel/pulls/7024/reviews --input - <<'EOF'\n{"body": "Looks fine.", "event": "COMMENT"}\nEOF`,
      'deny',
    ],
  ];
  for (let [command, expected] of cases) {
    let { decision } = invoke(dir, {
      tool_name: 'Bash',
      tool_input: { command },
    });
    assert.equal(decision, expected, command);
  }
});

test('a GraphQL review mutation carries its body inline', () => {
  let mutation = (body, event) =>
    `gh api graphql -f query='mutation { addPullRequestReview(input: {pullRequestId: "PR_kwDOAbcdef1234", body: "${body}"${event ? `, event: ${event}` : ''}}) { clientMutationId } }'`;
  assert.equal(
    bash(mutation('Looks fine.'), { transcript: CANT_LOAD }).decision,
    'allow',
  );
  assert.equal(
    bash(mutation('Looks fine.', 'COMMENT'), { transcript: CANT_LOAD })
      .decision,
    'deny',
  );
  assert.equal(
    bash(mutation(SAID, 'COMMENT'), { transcript: CANT_LOAD }).decision,
    'allow',
  );
});

test('reading a copy of a skill stands in for loading it', () => {
  // Every interfaces skill is loaded; boxel-ui-guidelines can't be, and the
  // session read it from the fetch:skills cache instead.
  let base = [
    listing(['gts-component-conventions', ...INTERFACES]),
    loadedSkill('gts-component-conventions'),
    ...INTERFACES.map(loadedSkill),
  ];
  let cache =
    '/repo/packages/boxel-cli/.boxel-skills-cache/v1/skills/boxel-ui-guidelines';
  let command = 'gh pr review 7024 --comment -b "Looks fine."';
  let withRead = (path) =>
    bash(command, { transcript: [...base, readFile(path)] }).decision;
  assert.equal(bash(command, { transcript: base }).decision, 'deny');
  assert.equal(withRead(`${cache}/SKILL.md`), 'allow');
  // The procedure itself is in the references.
  assert.equal(withRead(`${cache}/references/ui-review-procedure.md`), 'allow');
  // Another skill's file isn't a copy of this one.
  assert.equal(withRead('/repo/skills/boxel-design/SKILL.md'), 'deny');
  assert.equal(
    withRead('/repo/skills/boxel-ui-guidelines-old/SKILL.md'),
    'deny',
  );
});

test('with no skill listing, loading or the statement satisfies', () => {
  let command = 'gh pr review 7024 --comment -b "Looks fine."';
  let { decision, reason } = bash(command, { transcript: [] });
  assert.equal(decision, 'deny');
  assert.match(
    reason,
    /Load it with the Skill tool .* or, if this session can't load it/,
  );
  assert.equal(
    bash(
      `gh pr review 7024 --comment -b "gts-component-conventions, ${SAID}"`,
      { transcript: [] },
    ).decision,
    'allow',
  );
  assert.equal(
    bash(command, { transcript: LENS_SKILLS.map(loadedSkill) }).decision,
    'allow',
  );
});

test('a subagent loads the skills itself; a fork inherits them', () => {
  let dir = fixture([listing(LENS_SKILLS), ...LENS_SKILLS.map(loadedSkill)]);
  let agents = join(dir, 'session', 'subagents');
  mkdirSync(agents, { recursive: true });
  writeTranscript(join(agents, 'agent-a1.jsonl'), [
    { type: 'user', message: { content: 'hi' } },
  ]);
  for (let [agentType, expected] of [
    ['general-purpose', 'deny'],
    ['fork', 'allow'],
  ]) {
    let { decision } = invoke(dir, {
      agent_id: 'a1',
      agent_type: agentType,
      tool_name: 'Bash',
      tool_input: { command: 'gh pr review 7024 --approve' },
    });
    assert.equal(decision, expected, agentType);
  }
});

test('the catalog rules refuse without their skills', () => {
  let manifest = '/repo/packages/catalog/test-subset.json';
  let cases = [
    [
      'Bash',
      { command: 'pnpm --dir packages/catalog catalog:test-subset --bump' },
      /catalog-test-subset/,
    ],
    [
      'Edit',
      { file_path: manifest, old_string: 'a', new_string: 'b' },
      /catalog-test-subset/,
    ],
    [
      'Bash',
      {
        command:
          'gh pr create --body "Merges before: cardstack/boxel-catalog#1"',
      },
      /catalog-pairing/,
    ],
    [
      'Bash',
      { command: 'gh pr edit 5 -R cardstack/boxel-catalog --title x' },
      /catalog-pairing/,
    ],
  ];
  for (let [toolName, toolInput, skill] of cases) {
    let { decision, reason } = run(toolInput, { toolName });
    assert.equal(decision, 'deny', JSON.stringify(toolInput));
    assert.match(reason, skill);
  }
  assert.equal(bash('gh pr create --title x --body y').decision, 'allow');
});
