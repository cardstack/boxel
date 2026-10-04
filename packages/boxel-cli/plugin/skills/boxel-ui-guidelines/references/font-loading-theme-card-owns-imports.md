## Font Loading — Theme Card Owns Imports

Do NOT use `@import url(...)` inside `<style scoped>` blocks. Font imports belong to the Theme card. This file is the one place the rule is spelled out; other files point here.

`StructuredTheme` computes `cssImports`: it derives the Google Fonts stylesheet links from every font stack the theme names (`--font-sans/serif/mono` in both schemes and each typography slot's family), so those never drift from the fields and are never written by hand. Stylesheets that cannot be derived, such as Adobe Fonts or a self-hosted face, go in the theme's `customCssImports` list and are appended ahead of the derived ones. `CardContainer` links `cssImports` wherever the theme applies, so templates never `@import` a font.

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
