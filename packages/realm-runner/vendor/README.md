# Vendored BXL runtime

`bxl-runtime-bare.js` is the self-contained ESM bundle for
`@cardstack/bxl/runtime-bare` from commit
`eb9addc714e0111aa7bee5cf373a87cae11506e7`.

It is vendored because the BXL source repository is private and the package is
not published to npm. A git dependency would make every Boxel CI and deployment
install depend on cross-repository credentials.

The checked-in bundle has SHA-256:

```
f9009a6a5c9bbaecd4d73e3e17cd198bdc128a67a42081b212ff9c6fd0459922
```

To refresh it, check out the intended BXL commit, run `npm ci`, and build with:

```
npx esbuild src/runtime-bare.ts \
  --bundle \
  --format=esm \
  --platform=neutral \
  --target=es2022 \
  --minify \
  --legal-comments=inline \
  --main-fields=module,main \
  --conditions=import,module,default \
  --banner:js='/* eslint-disable -- generated vendored @cardstack/bxl runtime-bare; source commit COMMIT. See README and NOTICE. */' \
  --outfile=PATH/TO/packages/realm-runner/vendor/bxl-runtime-bare.js

pnpm exec eslint --fix packages/realm-runner/vendor/bxl-runtime-bare.js
```

Update the commit, banner, and digest together. The bundle remains licensed
under the terms in `NOTICE.md`.
