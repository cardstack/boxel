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

5. **Tag the commit** to release to production

## Linting

This package includes automated linting checks for JavaScript, TypeScript, and Glimmer templates:

- **ESLint**: Validates `.ts` and `.gts` files
- **ember-template-lint**: Validates `.hbs` files
- **ember-tsc**: TypeScript type checking

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
```

These commands run locally in this monorepo's `packages/catalog` package. If you submit a pull request to the [boxel-catalog](https://github.com/cardstack/boxel-catalog) repository, any linting run in CI is controlled by that repository's own workflow configuration.

### Catalog lint in boxel CI

The catalog type-checks and lints its cards against this monorepo, so a platform change here (removing a field from a command input, tightening a type, adding a lint rule) can break the catalog's lint without failing anything in boxel. The **Lint Catalog** workflow (`.github/workflows/lint-catalog.yaml`) guards against that: it checks out boxel-catalog into `contents/` and runs this package's lint against the change, using `scripts/lint-sweep.ts`.

- It lints boxel-catalog `main`, unless the boxel pull request's description pairs it with a boxel-catalog pull request, in which case it lints that pull request's head. A pair is a line in each description naming the other, keyed by merge order (`Merges before:` on the one that lands first, `Merges after:` on the other), and `scripts/pairing.ts` checks it from both sides. The `catalog-pairing` skill describes the protocol. Editing the description re-runs the workflow.
- With a pair, it lints catalog `main` against the change as well. The catalog's own CI Lint always lints against boxel `main`, so a catalog fix for a breaking boxel change can't pass there until the boxel change merges, and until the catalog pull request then merges, catalog `main` fails with whatever the boxel change broke. So errors the change adds to catalog `main` pass only while a catalog pull request the change merges before is open and approved, by GitHub's own review decision. Once it is approved, re-run the job, then merge the catalog pull request right after the boxel one. A catalog pull request the change merges after has to land first, so until it does the job fails, waiting on it. Without a pair, errors the change adds to catalog `main` fail, and the job says which lines to add to pair the change with a catalog fix.
- It fails only on errors the change introduces. When linting the catalog against the change finds errors, the job lints the same catalog revision against the pull request's base branch too, and errors that appear in both runs are listed as already present rather than failing the check. On pushes to `main` there is no base to compare with, so any error fails.
- The job summary lists each error, linking catalog files to their line in boxel-catalog.

To reproduce it locally, run `pnpm lint` here with the boxel-catalog revision the job names checked out in `contents/`.

## Deployment Pipeline

1. **Development**: Edit catalog content locally or remotely
2. **Pull Request**: Submit changes to boxel-catalog repository
3. **Review**: Code review process in GitHub
4. **Merge**: Changes automatically deployed to staging
5. **Tag**: Create a git tag to trigger production deployment

## Troubleshooting

### Catalog not appearing after changes

- Ensure the realm server is running (`pnpm start:all` in `packages/realm-server`)
- Verify the `contents/` directory exists and has the latest catalog content

### Catalog repository out of sync

- Run `pnpm catalog:update` to pull latest changes
- For a complete reset: `pnpm catalog:reset`
