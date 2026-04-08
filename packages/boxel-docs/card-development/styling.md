# Styling Cards

Boxel uses **scoped CSS** for card styling, ensuring styles don't leak between components. This guide covers the styling system, CSS variables, and theming.

## Scoped CSS

Every card template can include a `<style scoped>` tag:

```typescript
static isolated = class extends Component<typeof MyCard> {
  <template>
    <div class="my-card">
      <h1><@fields.title /></h1>
    </div>
    <style scoped>
      .my-card {
        padding: var(--boxel-sp-lg);
        border-radius: var(--boxel-border-radius-xl);
        background: var(--boxel-light);
      }
      h1 {
        font-size: var(--boxel-font-size-xl);
        color: var(--boxel-dark);
      }
    </style>
  </template>
};
```

### How Scoping Works

1. The `<style scoped>` block is extracted during compilation
2. Class names are made unique to prevent collisions
3. Styles only apply within the component's DOM
4. No risk of style leakage between cards

## CSS Variables

Boxel provides a comprehensive set of CSS custom properties. Use these for consistent styling:

### Spacing

| Variable | Purpose |
|----------|---------|
| `--boxel-sp-xxxs` | Extra extra extra small spacing |
| `--boxel-sp-xxs` | Extra extra small spacing |
| `--boxel-sp-xs` | Extra small spacing |
| `--boxel-sp-sm` | Small spacing |
| `--boxel-sp` | Base spacing |
| `--boxel-sp-lg` | Large spacing |
| `--boxel-sp-xl` | Extra large spacing |
| `--boxel-sp-xxl` | Extra extra large spacing |

### Typography

| Variable | Purpose |
|----------|---------|
| `--boxel-font-family` | Default font family |
| `--boxel-font-size-xs` | Extra small text |
| `--boxel-font-size-sm` | Small text |
| `--boxel-font-size` | Base text size |
| `--boxel-font-size-lg` | Large text |
| `--boxel-font-size-xl` | Extra large text |
| `--boxel-font-weight-bold` | Bold weight |

### Colors

| Variable | Purpose |
|----------|---------|
| `--boxel-dark` | Primary dark color |
| `--boxel-light` | Primary light color |
| `--boxel-purple` | Brand purple |
| `--boxel-400` | Muted text color |
| `--boxel-200` | Light border/background |
| `--boxel-highlight` | Highlight/focus color |
| `--boxel-error-100` | Error light background |
| `--boxel-error-200` | Error color |

### Borders & Shapes

| Variable | Purpose |
|----------|---------|
| `--boxel-border-radius` | Default border radius |
| `--boxel-border-radius-sm` | Small radius |
| `--boxel-border-radius-lg` | Large radius |
| `--boxel-border-radius-xl` | Extra large radius |
| `--boxel-border-color` | Default border color |

## Units

Use `rem` units for sizing (not `px`). This ensures cards scale properly across contexts:

```css
/* ✅ Good */
.title { font-size: 1.5rem; }
.card { padding: 1rem; }

/* ❌ Avoid */
.title { font-size: 24px; }
.card { padding: 16px; }
```

## Layout Patterns

### Card Layout

```css
.card-layout {
  display: flex;
  flex-direction: column;
  gap: var(--boxel-sp);
  padding: var(--boxel-sp-lg);
}
```

### Two-Column Layout

```css
.two-column {
  display: grid;
  grid-template-columns: 250px 1fr;
  gap: var(--boxel-sp-lg);
  height: 100%;
}
```

### Card Grid

```css
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(224px, 1fr));
  gap: var(--boxel-sp);
}
```

## Container Queries for Fitted Format

The `fitted` format should use CSS container queries to adapt to any size:

```css
.fitted-container {
  container-type: size;
  height: 100%;
}

/* Large container */
@container (min-height: 200px) {
  .fitted-content {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--boxel-sp);
  }
}

/* Medium container */
@container (min-height: 100px) and (max-height: 199px) {
  .fitted-content {
    display: flex;
    flex-direction: row;
    align-items: center;
  }
  .secondary { display: none; }
}

/* Small container */
@container (max-height: 99px) {
  .fitted-content {
    display: flex;
    align-items: center;
    overflow: hidden;
  }
  .avatar, .secondary { display: none; }
}

/* Aspect ratio adaptations */
@container (aspect-ratio > 1.5) {
  .fitted-content { flex-direction: row; }
}

@container (aspect-ratio <= 1) {
  .fitted-content { flex-direction: column; }
}
```

## Theming

### Theme Cards

Boxel has a `Theme` card type for defining reusable CSS variable sets:

```typescript
import { Theme } from 'https://cardstack.com/base/card-api';

export class DarkTheme extends Theme {
  static displayName = 'Dark Theme';

  // Theme CSS variables
  @field css = contains(CSSField);
}
```

### Card Header Colors

Set a custom header color:

```typescript
export class ImportantCard extends CardDef {
  static headerColor = '#ef4444';  // Red header
}
```

## Styling Best Practices

### Do

- Use `rem` units for sizing
- Use CSS variables from the Boxel design system
- Use `<style scoped>` for all component styles
- Use container queries for fitted format
- Keep styles focused on the component

### Don't

- Use `position: fixed` (restricted by ESLint rule — cards must stay in bounds)
- Use `px` units (use `rem` instead)
- Use global styles or `!important`
- Hardcode colors (use CSS variables)
- Use overly specific selectors

## Icons

Boxel includes a comprehensive icon library:

```typescript
import TaskIcon from '@cardstack/boxel-icons/clipboard-list';
import PersonIcon from '@cardstack/boxel-icons/user';
import MailIcon from '@cardstack/boxel-icons/mail';

export class MyCard extends CardDef {
  static icon = TaskIcon;

  static isolated = class extends Component<typeof MyCard> {
    <template>
      <PersonIcon width="20" height="20" />
      <span>Contact Info</span>
    </template>
  };
}
```

## Next Steps

- [Templates & Components](/card-development/templates) — Template patterns
- [Card Rendering](/core-concepts/card-rendering) — Format system
- [Themes & Customization](/tutorials/themes-and-customization) — Advanced theming
