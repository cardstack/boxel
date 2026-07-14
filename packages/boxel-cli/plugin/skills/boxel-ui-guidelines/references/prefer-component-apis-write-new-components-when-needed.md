## Prefer Component APIs; Write New Components When Needed

Always reach for existing boxel-ui components before writing custom HTML + CSS. Every custom element you avoid keeps templates shorter and inherits future design-system improvements automatically.

**Wrong — bespoke HTML for something boxel-ui already covers:**

```gts
<div class='pill'>Draft</div>
<style scoped>
  .pill {
    display: inline-flex;
    align-items: center;
    padding: 0.25rem 0.75rem;
    border-radius: 9999px;
    background: var(--muted);
    font-size: var(--boxel-font-size-xs);
  }
</style>
```

**Right — use the existing component:**

```gts
import { Pill } from '@cardstack/boxel-ui/components';

<Pill @variant='muted'>Draft</Pill>
```
