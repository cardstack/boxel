# Style Handling

Most parts of Boxel use scoped CSS via [glimmer-scoped-css](https://github.com/cardstack/glimmer-scoped-css).

But the actual implementation of how those styles get into the DOM varies wildly depending on context.

## In realms

A javascript module in a realm that uses scoped CSS goes through the realm's
transpilation pipeline. This runs the AST transformation step from
glimmer-scoped-css. It leaves the import resolution step alone, so the resulting
code will contain imports that end with `*.glimmer-scoped.css`.

At runtime, our loader has a custom middleware that knows how to satisfy these
special URLs. Each of them already contains the base64 encoded stylesheeet so no
extra requests are needed.

When serving pre-rendered content, the realm server identifies all the special
`*.glimmer-scoped.css` imports in the dependency graph of the given cards and
returns them with the pre-rendered HTML so they can get loaded (by the usual
middleware in the loader).

However, the index is only aware of modules within realms. Wherever imports span
outward to external dependencies, particularly all the shims provided via the
host app (see host/app/lib/externals), we cannot traverse all the way to all the
style dependencies. But this still results in valid styles in the browser, since
the shimmed implementations are already all statically imported into the host
app and thus their styles are already in the DOM.

## In the host app and addons (like @boxel/ui)

In the host app and its addons, the webpack-based implementation of
glimmer-scoped-css is in use. This means styles will be delivered by webpack's
usual style pipeline.
