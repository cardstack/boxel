# Themes & Customization

This guide covers theming, visual customization, and design system usage in Boxel cards.

## CSS Custom Properties

Boxel provides a comprehensive design token system via CSS custom properties. Use these for consistent, themeable cards.

### Spacing Scale

```css
--boxel-sp-xxxs   /* 0.125rem */
--boxel-sp-xxs    /* 0.25rem  */
--boxel-sp-xs     /* 0.5rem   */
--boxel-sp-sm     /* 0.75rem  */
--boxel-sp        /* 1rem     */
--boxel-sp-lg     /* 1.5rem   */
--boxel-sp-xl     /* 2rem     */
--boxel-sp-xxl    /* 3rem     */
```

### Typography

```css
--boxel-font-family
--boxel-font-size-xs
--boxel-font-size-sm
--boxel-font-size
--boxel-font-size-lg
--boxel-font-size-xl
```

### Colors

```css
--boxel-dark          /* Primary dark */
--boxel-light         /* Primary light */
--boxel-purple        /* Brand accent */
--boxel-400           /* Muted text */
--boxel-200           /* Light borders */
--boxel-highlight     /* Focus/selection */
```

## Card Header Styling

Set a custom header color for your card type:

```typescript
export class UrgentTask extends CardDef {
  static displayName = 'Urgent Task';
  static headerColor = '#ef4444';  // Red
}

export class Feature extends CardDef {
  static displayName = 'Feature';
  static headerColor = '#22c55e';  // Green
}
```

## Layout Options

### Wide Format

Request a wider layout for app-style cards:

```typescript
export class Dashboard extends CardDef {
  static prefersWideFormat = true;
}
```

## Theme Cards

Create reusable themes as cards:

```typescript
import { Theme } from 'https://cardstack.com/base/card-api';
import CSSField from 'https://cardstack.com/base/css';

export class DarkTheme extends Theme {
  static displayName = 'Dark Theme';

  @field css = contains(CSSField);
}
```

## Responsive Card Design with Container Queries

The `fitted` format should adapt to any container size using CSS container queries:

```typescript
static fitted = class extends Component<typeof MyCard> {
  <template>
    <div class="card">
      <div class="avatar"><@fields.avatar /></div>
      <div class="primary"><@fields.name /></div>
      <div class="secondary"><@fields.subtitle /></div>
      <div class="detail"><@fields.description /></div>
    </div>
    <style scoped>
      .card {
        display: grid;
        grid-template: "avatar primary" "avatar secondary" / auto 1fr;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs);
        height: 100%;
        align-content: center;
      }

      /* Large: show everything */
      @container fitted-card (min-height: 200px) {
        .card {
          grid-template:
            "avatar primary"
            "avatar secondary"
            "detail detail" / auto 1fr;
        }
      }

      /* Medium: hide details */
      @container fitted-card (max-height: 120px) {
        .detail { display: none; }
      }

      /* Small: hide avatar */
      @container fitted-card (max-height: 80px) {
        .avatar { display: none; }
        .card { grid-template: "primary" "secondary" / 1fr; }
      }

      /* Tiny: single line */
      @container fitted-card (max-height: 57px) {
        .secondary, .detail, .avatar { display: none; }
        .card {
          grid-template: "primary" / 1fr;
          align-content: center;
        }
      }
    </style>
  </template>
};
```

## Icon Library

Boxel includes thousands of icons via `@cardstack/boxel-icons`:

```typescript
import UserIcon from '@cardstack/boxel-icons/user';
import MailIcon from '@cardstack/boxel-icons/mail';
import StarIcon from '@cardstack/boxel-icons/star';
import CalendarIcon from '@cardstack/boxel-icons/calendar';

export class Contact extends CardDef {
  static icon = UserIcon;
}
```

Icons accept `width` and `height` props for inline sizing.

## Best Practices

1. **Always use CSS variables** — Never hardcode colors, spacing, or fonts
2. **Use `rem` units** — Cards scale properly across contexts
3. **Use scoped styles** — Always add `scoped` to `<style>` tags
4. **Design for all sizes** — Use container queries in `fitted` format
5. **Keep styles minimal** — Let the Boxel UI system do the heavy lifting

## Next Steps

- [Styling Cards](/card-development/styling) — Full styling guide
- [Patterns & Best Practices](/tutorials/patterns) — Architecture patterns
- [Card Rendering](/core-concepts/card-rendering) — Format system
