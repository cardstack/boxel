# Example: Creating a Card Definition + Instance

## Input

Ticket: "Create a StickyNote card with title and body fields"

## Expected Output

```json
[
  {
    "type": "invoke_tool",
    "tool": "search-realm",
    "toolArgs": { "query": "StickyNote", "realm": "target" }
  },
  {
    "type": "create_file",
    "path": "sticky-note.gts",
    "realm": "target",
    "content": "import { contains, field, CardDef, Component } from '@cardstack/base/card-api';\nimport StringField from '@cardstack/base/string';\nimport MarkdownField from '@cardstack/base/markdown';\n\nexport class StickyNote extends CardDef {\n  static displayName = 'Sticky Note';\n  @field title = contains(StringField);\n  @field body = contains(MarkdownField);\n\n  static fitted = class Fitted extends Component<typeof StickyNote> {\n    <template>\n      <div class='sticky-note'>\n        <h3>{{@model.title}}</h3>\n        <p>{{@model.body}}</p>\n      </div>\n      <style scoped>\n        .sticky-note { padding: 1rem; background: #fef3c7; border-radius: 8px; }\n        h3 { margin: 0 0 0.5rem; }\n      </style>\n    </template>\n  };\n}\n"
  },
  {
    "type": "create_file",
    "path": "StickyNote/welcome-note.json",
    "realm": "target",
    "content": "{\n  \"data\": {\n    \"type\": \"card\",\n    \"attributes\": {\n      \"title\": \"Welcome\",\n      \"body\": \"This is a sample sticky note.\"\n    },\n    \"meta\": {\n      \"adoptsFrom\": {\n        \"module\": \"../sticky-note\",\n        \"name\": \"StickyNote\"\n      }\n    }\n  }\n}\n"
  },
  {
    "type": "create_test",
    "path": "Tests/sticky-note.spec.ts",
    "realm": "target",
    "content": "import { test, expect } from '@playwright/test';\n\ntest('StickyNote renders title and body', async ({ page }) => {\n  // test implementation\n});\n"
  }
]
```
