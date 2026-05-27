---
name: pr-comment-attribution
description: Prefix every PR comment the agent posts with the literal "[Claude Code 🤖]" marker so reviewers can tell the agent's replies apart from the account owner's own. Use whenever posting a PR review-thread reply, an inline review comment, or a top-level issue comment on a PR — via gh pr comment, gh api .../comments, or the GitHub MCP comment tools.
---

# PR Comment Attribution

The agent posts PR comments under the human account owner's GitHub identity. Without a marker, reviewers cannot tell an agent-authored reply from one the account owner wrote themselves. Every comment the agent posts therefore **begins with the literal prefix**:

```
[Claude Code 🤖]
```

Exactly that — square brackets, the words `Claude Code`, a space, the robot emoji. Same capitalization and spacing every time.

## Where it applies

Every PR comment the agent posts, with no exceptions:

- **Per-thread inline replies** on review comments
- **Top-level issue comments** on a PR
- **Review-summary bodies**

…across whichever tool posts it:

- `gh pr comment`
- `gh api repos/<owner>/<repo>/issues/<n>/comments` and `.../pulls/<n>/comments/<id>/replies`
- the GitHub MCP tools (`add_reply_to_pull_request_comment`, `add_issue_comment`, etc.)

## Example

```
[Claude Code 🤖] Good catch — fixed in abc1234. The endpoint now validates
the token before reading the body, so the unauthenticated path can't reach
the parser.
```

## Self-check

Before sending any PR comment: does the body start with `[Claude Code 🤖]`? If not, prepend it. The prefix leads the comment — it is the first thing in the body, not buried mid-paragraph.
