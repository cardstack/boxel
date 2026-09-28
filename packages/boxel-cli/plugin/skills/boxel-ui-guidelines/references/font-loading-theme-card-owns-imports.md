## Font Loading — Theme Card Owns Imports

Do NOT use `@import url(...)` inside `<style scoped>` blocks. Font imports belong to the Theme card: a StructuredTheme derives Google Fonts links in `cssImports` from its font stacks, and other stylesheets go in its `customCssImports`. The runtime automatically passes them to `CardContainer`.

**Wrong:**
```css
<style scoped>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap');
  .title { font-family: 'Bebas Neue', sans-serif; }
</style>
```

**Correct:**
```css
<style scoped>
  /* Font is loaded by the Theme card's cssImports field */
  .title { font-family: var(--boxel-heading-font-family); }
</style>
```
