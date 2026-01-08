# Boxel-Homepage Realm

The Boxel Homepage Realm is a specialized realm in the Boxel system that hosts the Boxel homepage and related sample cards and documents. The files themselves are maintained in a separate repository ([boxel-home](https://github.com/cardstack/boxel-home)) to enable independent versioning and deployment.

## Architecture

- **Homepage Source**: Files are stored in the [boxel-home](https://github.com/cardstack/boxel-home) repository
- **Local Development**: Homepage files are cloned into `packages/boxel-homepage-realm/contents/` for local editing
- **Homepage Writer User**: A special `homepage_writer` Matrix user has permissions to edit the files in the realm
- **Deployment Pipeline**: Changes flow from local development → boxel-home repo → staging → production

## Setup

### Prerequisites

Make sure you have completed the standard Boxel setup as described in the [main README](../../README.md), including:

- Matrix server running
- Postgres database
- Host app and realm server

### Initial Homepage Setup

If you have started from scratch these should have been automatically run for you, but they are safe to run again.

1. **Clone the homepage repository** (automatically done with `start:all` or `start:development` in the realm-server package):

   ```bash
   cd packages/boxel-homepage-realm
   pnpm boxel-homepage:setup
   ```

2. **Register the homepage writer user**:

   ```bash
   cd packages/matrix
   pnpm register-homepage-writer
   ```

   This creates a Matrix user with credentials:
   - Username: `homepage_writer`
   - Password: `password`

## Homepage Management Scripts

The boxel-homepage realm package includes helper scripts for managing the homepage repository:

| Script                       | Description                                                           |
| ---------------------------- | --------------------------------------------------------------------- |
| `pnpm boxel-homepage:setup`  | Clones the boxel-home repository into `contents/` if it doesn't exist |
| `pnpm boxel-homepage:update` | Pulls latest changes from the boxel-home repository                   |
| `pnpm boxel-homepage:reset`  | Removes the `contents/` directory and re-clones the repository        |

## Development Workflows

### Local Development

This workflow is ideal for rapid iteration and testing of the homepage:

1. **Log in as homepage_writer** in the Boxel interface using the credentials above

2. **Visit `/boxel-homepage`** to view the workspace. This workspace will not show up in the workspace chooser.

3. **Edit files directly** in the Boxel interface:
   - Navigate to the boxel-homepage realm
   - Create or modify the files using the visual editor
   - Changes are automatically saved to `packages/boxel-homepage-realm/contents/`

4. **Test your changes** immediately in the live environment

5. **Commit and push** when satisfied:
   - **IMPORTANT**: Edits made as `homepage_writer` are saved locally and are not automatically synced to the **private** `boxel-home` repo. You need your own git access to push changes.

   ```bash
   cd packages/boxel-homepage-realm/contents
   git checkout -b your-feature-branch
   git add .
   git commit -m "Update boxel homepage"
   git push origin your-feature-branch
   ```

6. **Create a Pull Request** in the [boxel-home](https://github.com/cardstack/boxel-home) repository

7. **Deploy to staging** happens automatically when the PR is merged

8. **Tag the commit** to release to production

## Deployment Pipeline

1. **Development**: Edit files locally or remotely
2. **Pull Request**: Submit changes to boxel-home repository
3. **Review**: Code review process in GitHub
4. **Merge**: Changes automatically deployed to staging
5. **Tag**: Create a git tag to trigger production deployment

## Troubleshooting

### Changes not reflecting in the UI

- Ensure the boxel-homepage realm server is running (`pnpm start:all` in `packages/realm-server`)
- Check that you're logged in as `homepage_writer`
- Verify the `contents/` directory exists and has the latest homepage files

### Permission denied when editing boxel-homepage realm

- Confirm you're logged in as the `homepage_writer` user
- Check that the user was created correctly: `pnpm register-homepage-writer` in `packages/matrix`

### Boxel-Home repository out of sync

- Run `pnpm boxel-homepage:update` to pull latest changes
- For a complete reset: `pnpm boxel-homepage:reset`
