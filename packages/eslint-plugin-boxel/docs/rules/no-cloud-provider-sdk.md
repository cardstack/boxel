# Disallow loading a cloud provider SDK outside the modules that adapt it, by static import, re-export, dynamic `import()`, or `require()` (`@cardstack/boxel/no-cloud-provider-sdk`)

<!-- end auto-generated rule header -->

Runtime code reaches a proprietary cloud service only through an interface named for the capability Boxel needs, so a provider's SDK belongs only in that interface's adapter (ADR 003 §1.2). This rule reports every way a module can load one: a static import or re-export, a dynamic `import()`, `require()` or `require.resolve()` (whatever `require` is bound to, so a `createRequire` result counts), and TypeScript's `import x = require()`.

A source the rule can't read statically, such as `import(name)`, is not reported.

## Options

- `patterns` — the restricted modules. A pattern ending in `/*` names every module under that scope or path, such as `@aws-sdk/*`. Any other pattern names one module exactly, such as `aws-sdk`.

The repository configures the patterns, the packages the rule covers, and the adapter modules exempt from it in `eslint/cloud-provider-sdk-imports.cjs`.
