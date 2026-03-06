# catalog-test-runner

This runner lets you execute catalog integration tests by passing a test module file.

## How it works

1. Run `scripts/run-catalog-runner.sh` with `--test-module`.
2. Script copies your module into:
   - `tests/integration/catalog/generated/test-module.gts`
3. QUnit runs `tests/integration/catalog/catalog-runner-test.gts`.
4. The runner reads `default export` from `generated/test-module.gts` and executes each case.

`setupCatalogIsolatedCardTest(..., { setupRealm: 'manual' })` is used so each case can seed its own realm contents via `this.setupCatalogRealm(seed, cacheKey)`.

## Script

Path:
- `packages/host/scripts/run-catalog-runner.sh`

Arguments:
- `--test-module <path>`: required path to `.gts` / `.ts` / `.js` module
- `--filter <qunit filter>`: optional, defaults to `Integration | Catalog | runner`
- `--no-run`: optional, only generate `generated/test-module.gts`

## Module API

Your test module must `export default` an object with `cases`:

```ts
export default {
  cases: [
    {
      id: 'case-name',
      format: 'isolated', // optional, defaults to 'isolated'
      seed: async (ctx) => ({
        'SomeCard/instance.json': {
          data: {
            type: 'card',
            attributes: {},
            meta: { adoptsFrom: { module: '...', name: '...' } },
          },
        },
      }),
      cardURL: (ctx) => `${ctx.testRealmURL}SomeCard/instance`,
      test: async (ctx, assert) => {
        // DOM assertions here
      },
    },
  ],
} as any;
```

### Case fields

- `id`: test name in QUnit output
- `seed`: object or function returning realm contents to load before rendering
- `cardURL`: URL or function returning URL of card instance to render
- `test(ctx, assert)`: assertions/actions after render
- `format`: render format (`isolated`, `fitted`, etc.)

## Logging

Runner logs per case:
- `[catalog-runner] START <case-id>`
- `[catalog-runner] PASS <case-id>`

These appear in browser logs and CI test output.

## Commands

From `packages/host`:

```bash
./scripts/run-catalog-runner.sh \
  --test-module ./tests/integration/catalog/modules/daily-report-dashboard.module.gts
```

or:

```bash
pnpm test:catalog:runner
```

Generate only:

```bash
./scripts/run-catalog-runner.sh \
  --test-module ./tests/integration/catalog/modules/daily-report-dashboard.module.gts \
  --no-run
```

## Browser URL

After host test app is running:

- `http://localhost:4200/tests?filter=Integration%20%7C%20Catalog%20%7C%20runner`
- `http://localhost:4200/tests?filter=daily-report-dashboard`
