---
name: markdown-edit
description: Surgical edits to long MarkdownField values via apply-markdown-edit.
boxel:
  kind: skill
  tools:
    - codeRef:
        module: '@cardstack/boxel-host/tools/apply-markdown-edit'
        name: default
      requiresApproval: true
---

# Markdown Field Editing

**SCOPE:** MarkdownField edits in card instances only. Use `patch-fields` for other fields, SEARCH/REPLACE for code.

## When to Use
- Large markdown where full replacement risks truncation
- Surgical edits (headings, bullets, paragraphs) in lengthy docs
- Sequential multi-step changes
- **Deletions** where you need precise control

## Core Concept: Focused Transformation

The command supports two modes:

### Mode 1: Full Field (Legacy)
Send only `markdownDiff` and let the model figure out where to apply it in the full document.

### Mode 2: Focused Edit (Recommended)
Send `currentContent` (the exact section you want to transform) plus `markdownDiff` (what it should become).

**For deletions, Mode 2 is essential:**
- `currentContent`: The full section INCLUDING what you want deleted
- `markdownDiff`: Only the anchors that should remain (the deleted content is omitted)

## Parameters

| Param | Purpose |
|-------|--------|
| `cardId` | Full card URL |
| `fieldPath` | e.g., `content`, `instructions` |
| `currentContent` | **Optional but recommended**: The exact current text to transform |
| `markdownDiff` | The replacement text (what remains after the edit) |
| `instructions` | Brief intent (for logging/debugging) |

## Patterns

### Modify a Line
```
currentContent: "### Quarterly Report\n"
markdownDiff: "### Quarterly Report (Final)\n"
instructions: "Add (Final) suffix to heading"
```

### Delete a Section (Key Pattern!)

**Use the expanded-lasso approach:** Include content BEFORE and AFTER the deleted block in both `currentContent` and `markdownDiff`.

```
BEFORE:
### 5.2 Evidence Evaluation
...content...

### 5.3 Critical Thinking
...content to delete...

### 5.4 Building Frameworks
...content...

TO DELETE 5.3:
currentContent: "### 5.2 Evidence Evaluation\n...[end of 5.2 content]...\n\n### 5.3 Critical Thinking\n...[full content of 5.3]...\n\n### 5.4 Building Frameworks"
markdownDiff: "### 5.2 Evidence Evaluation\n...[end of 5.2 content]...\n\n### 5.4 Building Frameworks"
instructions: "Delete section 5.3 entirely"
```

**Why this works:**
- The `currentContent` shows the full "before" state with anchors on both sides
- The `markdownDiff` shows the "after" state (5.3 is simply absent)
- The overlapping anchors (5.2 ending and 5.4 start) make it crystal clear what's being removed
- No ambiguity about whitespace or neighboring content

### Insert Content
```
currentContent: "## Features\n- Existing item"
markdownDiff: "## Features\n- New item\n- Existing item"
instructions: "Add new item before existing"
```

## Rules

1. **Use `currentContent` for deletions** — it makes the before/after explicit
2. **Expand the lasso** — include stable content before AND after the target
3. **One logical change per call** — sequential, not parallel
4. **Exact match required** — `currentContent` must match the document exactly
5. **Diff = final state** — show what remains, not what's removed
6. **Include anchors in both** — `markdownDiff` should have the same before/after anchors as `currentContent`

**⚠️ CRITICAL: Execute edits sequentially, not in parallel.** Multiple command calls issued together are NOT guaranteed to run in order. For dependent revisions (e.g., delete then renumber), either:
- Construct a **single edit** that accomplishes everything, OR
- Execute **one edit at a time**, waiting for user approval between each

## Error Recovery

- "currentContent not found" → Check for exact match (whitespace, newlines matter)
- Match failed? → Provide more context in `currentContent`
- Overwrote neighbor? → Re-apply with exact text restoration