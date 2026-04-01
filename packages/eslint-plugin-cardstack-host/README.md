# eslint-plugin-cardstack-host

Custom ESLint rules for the Boxel host app.

## Usage

Add `cardstack-host` to the plugins section of your `.eslintrc` configuration file:

```json
{
  "plugins": ["cardstack-host"]
}
```

Then configure the rules you want to use under the rules section:

```json
{
  "rules": {
    "cardstack-host/rule-name": "error"
  }
}
```

## Rules

<!-- begin auto-generated rules list -->

💼 Configurations enabled in.\
✅ Set in the `recommended` configuration.\
🔧 Automatically fixable by the [`--fix` CLI option](https://eslint.org/docs/user-guide/command-line-interface#--fix).

| Name                                                                   | Description                                                                                          | 💼 | 🔧 |
| :--------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------- | :- | :- |
| [host-commands-registered](docs/rules/host-commands-registered.md)     | Ensure every host command module is imported, shimmed, and exported                                  | ✅  |    |
| [mock-window-only](docs/rules/mock-window-only.md)                     | Enforce use of window mock localStorage                                                              | ✅  | 🔧 |
| [no-percy-direct-import](docs/rules/no-percy-direct-import.md)         | Forbid importing percySnapshot directly from @percy/ember; use @cardstack/host/tests/helpers instead | ✅  | 🔧 |
| [wrapped-setup-helpers-only](docs/rules/wrapped-setup-helpers-only.md) | Enforce use of wrapped setup helpers that use ember-window-mock                                      | ✅  |    |

<!-- end auto-generated rules list -->

Development note: after adding a new rule, run `pnpm update` to re-generate docs and recommended-rules list.
