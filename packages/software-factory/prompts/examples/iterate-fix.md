# Example: Fixing Code After Test Failure

## Input

Previous actions created `sticky-note.gts` and a test spec. The test failed:

```
Failure: renders fitted view with title and body
Error: Timed out 5000ms waiting for expect(locator).toHaveText("Welcome")
Locator: page.locator('.sticky-note h3')
```

## Expected Output

The agent identifies that the selector is wrong (the component uses a different class name) and fixes the implementation:

```json
[
  {
    "type": "invoke_tool",
    "tool": "search-realm",
    "toolArgs": { "query": "StickyNote", "realm": "target" }
  },
  {
    "type": "update_file",
    "path": "sticky-note.gts",
    "realm": "target",
    "content": "import { contains, field, CardDef, Component } from '@cardstack/base/card-api';\nimport StringField from '@cardstack/base/string';\nimport MarkdownField from '@cardstack/base/markdown';\n\nexport class StickyNote extends CardDef {\n  static displayName = 'Sticky Note';\n  @field title = contains(StringField);\n  @field body = contains(MarkdownField);\n\n  static fitted = class Fitted extends Component<typeof StickyNote> {\n    <template>\n      <div class='sticky-note'>\n        <h3 data-test-title>{{@model.title}}</h3>\n        <p data-test-body>{{@model.body}}</p>\n      </div>\n      <style scoped>\n        .sticky-note { padding: 1rem; background: #fef3c7; border-radius: 8px; }\n        h3 { margin: 0 0 0.5rem; }\n      </style>\n    </template>\n  };\n}\n"
  },
  {
    "type": "update_test",
    "path": "Tests/sticky-note.spec.ts",
    "realm": "target",
    "content": "import { test, expect } from '@playwright/test';\n\ntest.describe('StickyNote', () => {\n  test('renders fitted view with title and body', async ({ page }) => {\n    await page.goto('/StickyNote/welcome-note');\n    await expect(page.locator('[data-test-title]')).toHaveText('Welcome');\n    await expect(page.locator('[data-test-body]')).toContainText('sample sticky note');\n  });\n});\n"
  }
]
```
