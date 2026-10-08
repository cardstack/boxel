# Cardstack Catalog

The **Cardstack Catalog** is the official catalog realm — the source of truth for catalog content and the destination for community submissions. The content is maintained in a separate repository ([boxel-catalog](https://github.com/cardstack/boxel-catalog)) for independent versioning and deployment.

## Architecture

- **Catalog Source**: Content is stored in the [boxel-catalog](https://github.com/cardstack/boxel-catalog) repository
- **Local Development**: Catalog content is cloned into `packages/catalog/contents/` for local editing
- **Deployment Pipeline**: Changes flow from local development → boxel-catalog repo → staging → production
- **URL**: Served at `/catalog/` in every environment (localhost, staging, production)

## Setup

### Prerequisites

Make sure you have completed the standard Boxel setup as described in the [main README](../../README.md), including:

- Matrix server running
- Postgres database
- Host app and realm server

### Initial Catalog Setup

If you have started from scratch these should have been automatically run for you, but they are safe to run again.

1. **Clone the catalog repository** (run this when you need a local copy):

   ```bash
   cd packages/catalog
   pnpm catalog:setup
   ```

## Catalog Management Scripts

The catalog realm package includes helper scripts for managing the catalog repository:

| Script                | Description                                                              |
| --------------------- | ------------------------------------------------------------------------ |
| `pnpm catalog:setup`  | Clones the boxel-catalog repository into `contents/` if it doesn't exist |
| `pnpm catalog:update` | Pulls latest changes from the boxel-catalog repository                   |
| `pnpm catalog:reset`  | Removes the `contents/` directory and re-clones the repository           |

## Development Workflows

### Local Catalog Development

This workflow is ideal for rapid iteration and testing of catalog content:

1. **Edit catalog content locally**

   - Changes are saved to `packages/catalog/contents/`

2. **Commit and push** when satisfied:

   ```bash
   cd packages/catalog/contents
   git checkout -b your-feature-branch
   git add .
   git commit -m "Update catalog content"
   git push origin your-feature-branch
   ```

3. **Create a Pull Request** in the [boxel-catalog](https://github.com/cardstack/boxel-catalog) repository

4. **Deploy to staging** happens automatically when the PR is merged

5. **Deploy to production** with boxel-catalog's "Deploy to production" workflow, or let the next boxel production deploy carry it (see [Deployment Pipeline](#deployment-pipeline))

## Linting

This package includes automated linting checks for JavaScript, TypeScript, and Glimmer templates:

- **ESLint**: Validates `.ts` and `.gts` files
- **ember-template-lint**: Validates `.hbs` files
- **ember-tsc**: TypeScript type checking
- **lint:css-vars** (`lint/css-variables.ts`): CSS custom properties in `.gts` styles

### Running Linting

```bash
# Check for linting issues
pnpm lint

# Auto-fix linting issues
pnpm lint:fix
```

Individual linting commands:

```bash
pnpm lint:js      # ESLint check
pnpm lint:hbs     # Template lint check
pnpm lint:types   # TypeScript type check
pnpm lint:css-vars # CSS custom properties (see below)
```

These commands run locally in this monorepo's `packages/catalog` package. If you submit a pull request to the [boxel-catalog](https://github.com/cardstack/boxel-catalog) repository, any linting run in CI is controlled by that repository's own workflow configuration.

### CSS variable lint

A `var(--x)` that nothing defines resolves to nothing, so the property silently falls back. `pnpm lint:css-vars` reads every `var()` in `contents/` and reports:

| Rule                                  | Catches                                                                                                                          | Use instead                                                                                                                                                                                                                                                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `css-variables/undefined`             | A variable that is not in `packages/boxel-ui/src/styles/*.css`, not a documented Pret UI knob, and not declared in the same file | The theme token for the role (`theme.css`), or declare the variable in the component's own styles. `--font-heading` becomes `--boxel-heading-font-family` (`--boxel-section-heading-font-family` for h2, `--boxel-subheading-font-family` for h3); body text is `--font-sans`, a mono register `--font-mono` |
| `css-variables/theme-fallback`        | `var(--foreground, #333)`: a fallback on a theme contract token                                                                  | `var(--foreground)`. Every card renders under a theme that defines the contract; `CardContainer` is the only place that carries a fallback                                                                                                                                                                   |
| `css-variables/private-name-fallback` | `var(--x-ink, var(--foreground))`: a private name with a theme variable as its fallback                                          | `var(--foreground)`, dropping the private name. A per-instance knob a component documents (`--pretui-button-radius`) is declared by the component and is not flagged                                                                                                                                         |
| `css-variables/font-shorthand`        | `font: 600 0.8rem/1.2 …` (`font: inherit` is allowed)                                                                            | `font-size` and `font-weight`, with `line-height` only where it differs from the body role                                                                                                                                                                                                                   |

The defined set is derived from the checkout on every run: custom properties declared in `packages/boxel-ui/src/styles/*.css`, and `--pretui-*` names declared or documented in `packages/pretui/components`. The theme contract is what `theme.css` declares. Nothing is typed into the script. A variable one file declares and another reads (a shared defaults module) is reported, since the read has no declaration in its own component; declare it where it is read.

`lint/css-variables-baseline.json` records the violations the catalog already had when the rule landed, as a count per file, rule and variable. Those are not reported; any occurrence beyond the recorded count is. Regenerate it, after fixing violations, with `node lint/css-variables.ts --write-baseline`; `--no-baseline` lists everything. The script lives in `lint/`, not `scripts/`, because the catalog's own CI removes `scripts/` before it runs `pnpm run lint`. `pnpm test:css-vars` runs its tests.

### Catalog lint in boxel CI

The catalog type-checks and lints its cards against this monorepo, so a platform change here (removing a field from a command input, tightening a type, adding a lint rule) can break the catalog's lint without failing anything in boxel. The **Lint Catalog** workflow (`.github/workflows/lint-catalog.yaml`) guards against that: it checks out boxel-catalog into `contents/` and runs this package's lint against the change, using `scripts/lint-sweep.ts`.

- It lints boxel-catalog `main`, unless the boxel pull request's description pairs it with a boxel-catalog pull request, in which case it lints that pull request's head. A pair is a line in each description naming the other, keyed by merge order (`Merges before:` on the one that lands first, `Merges after:` on the other), and `scripts/pairing.ts` checks it from both sides. A pull request in a pair targets `main`, or is stacked on an open pull request of its own repository, and is retargeted to `main` once that pull request merges. The `catalog-pairing` skill describes the protocol. Editing the description re-runs the workflow.
- With a pair, it lints catalog `main` against the change as well. The catalog's own CI Lint always lints against boxel `main`, so a catalog fix for a breaking boxel change can't pass there until the boxel change merges, and until the catalog pull request then merges, catalog `main` fails with whatever the boxel change broke. A catalog pull request the change merges after has to land first, so until it does the job fails, waiting on it. Otherwise, errors the change adds to catalog `main` pass only while a catalog pull request the change merges before is open, ready for review, and approved, by GitHub's own review decision. While either of the two is stacked on a parent, this fails too, because the stacked one lands on its parent's branch rather than `main`; retarget it once the parent merges. Once the catalog pull request is approved and neither is stacked, re-run the job, then merge the catalog pull request right after the boxel one. A change on the catalog side, including a push, doesn't re-run this job, so re-run it by hand. Without a pair, errors the change adds to catalog `main` fail, and the job says which lines to add to pair the change with a catalog fix.
- It also lints the whole catalog at the revision `test-subset.json` pins, because production deploys a boxel commit with the catalog at its pin. Every error the change adds there fails, paired or not, compared with the base branch's pin linted against the base branch. A change that breaks the catalog pins the head of the catalog pull request that fixes it, one it merges before, and that pull request merges right after it. Until then, the catalog `main` gate above fails unless the catalog pull request is approved. When the fix also changes a subset file, the Catalog Test Subset check accepts the pin on the same terms. Once the catalog pull request has merged, the lockstep deploy deploys its merge commit in place of the pinned head, whatever the merge method.
- It fails only on errors the change introduces. When linting the catalog against the change finds errors, the job lints the same catalog revision against the pull request's base branch too, and errors that appear in both runs are listed as already present rather than failing the check. On pushes to `main` there is no base to compare with, so any error fails.
- The job summary lists each error, linking catalog files to their line in boxel-catalog.

To reproduce it locally, run `pnpm lint` here with the boxel-catalog revision the job names checked out in `contents/`.

## Deployment Pipeline

1. **Development**: Edit catalog content locally or remotely
2. **Pull Request**: Submit changes to boxel-catalog repository
3. **Review**: Code review process in GitHub
4. **Merge**: Changes automatically deployed to staging, which runs boxel `main`
5. **Production**: boxel-catalog's "Deploy to production" workflow deploys the catalog, in one of two ways:
   - **In lockstep with boxel.** Manual Deploy [boxel] to production deploys the catalog revision the deployed boxel pins in `test-subset.json` twice. The run before the release ships the catalog changes the new boxel needs, and the run after it ships the rest. Neither moves production's catalog backwards.
   - **Ahead of boxel.** Run the workflow by hand from boxel-catalog's Actions tab to deploy catalog `main`, for changes that need nothing new from boxel.

   Before it changes anything, the deploy checks each catalog pull request since the last production deploy. It refuses when one says `Merges after: cardstack/boxel#N` and production doesn't run #N yet, and it names both pull requests. The script is `scripts/catalog-deploy-check.ts`, and the `catalog-deploy` skill (`.claude/skills/catalog-deploy/SKILL.md`) explains how to read a refusal.

## Troubleshooting

### Catalog not appearing after changes

- Ensure the realm server is running (`pnpm start:all` in `packages/realm-server`)
- Verify the `contents/` directory exists and has the latest catalog content

### Catalog repository out of sync

- Run `pnpm catalog:update` to pull latest changes
- For a complete reset: `pnpm catalog:reset`
