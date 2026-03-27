# Example: Generating a Test Spec

## Input

Ticket: "Create tests for the StickyNote card"

Implementation files already exist:

- `sticky-note.gts` (target realm) — defines StickyNote with title and body fields
- `StickyNote/welcome-note.json` (target realm) — sample instance

## Expected Output

```json
[
  {
    "type": "create_test",
    "path": "TestSpec/sticky-note.spec.ts",
    "realm": "test",
    "content": "import { test, expect } from '@playwright/test';\nimport { setupFactoryTest } from '../fixtures';\n\ntest.describe('StickyNote', () => {\n  test('renders fitted view with title and body', async ({ page }) => {\n    await page.goto('/StickyNote/welcome-note');\n    await expect(page.locator('.sticky-note h3')).toHaveText('Welcome');\n    await expect(page.locator('.sticky-note p')).toContainText('sample sticky note');\n  });\n\n  test('card instance has correct adoptsFrom', async ({ page }) => {\n    const response = await page.request.get('/StickyNote/welcome-note.json');\n    const json = await response.json();\n    expect(json.data.meta.adoptsFrom.name).toBe('StickyNote');\n  });\n});\n"
  }
]
```
