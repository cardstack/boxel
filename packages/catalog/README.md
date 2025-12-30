# Catalog Realm

The Catalog Realm is a specialized realm in the Boxel system that hosts the catalog content. The catalog content is maintained in a separate repository ([boxel-catalog](https://github.com/cardstack/boxel-catalog)) to enable independent versioning and deployment.

## Architecture

- **Catalog Source**: Content is stored in the [boxel-catalog](https://github.com/cardstack/boxel-catalog) repository
- **Local Development**: Catalog content is cloned into `packages/catalog/contents/` for local editing
- **Deployment Pipeline**: Changes flow from local development → boxel-catalog repo → staging → production

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

| Script                | Description                                                               |
| --------------------- | ------------------------------------------------------------------------- |
| `pnpm catalog:setup`  | Clones the boxel-catalog repository into `contents/` if it doesn't exist  |
| `pnpm catalog:update` | Pulls latest changes from the boxel-catalog repository                    |
| `pnpm catalog:reset`  | Removes the `contents/` directory and re-clones the repository            |

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
