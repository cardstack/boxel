# Enforce use of window mock localStorage (`@cardstack/host/mock-window-only`)

💼 This rule is enabled in the ✅ `recommended` config.

🔧 This rule is automatically fixable by the [`--fix` CLI option](https://eslint.org/docs/latest/user-guide/command-line-interface#--fix).

<!-- end auto-generated rule header -->

Use `window.localStorage` from `ember-window-mock` instead of directly accessing `localStorage`. This ensures tests can properly mock browser storage.
