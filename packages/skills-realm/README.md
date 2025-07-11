# Skills Realm

The Skills Realm is a specialized realm in the Boxel system that hosts AI skills. The skills themselves are maintained in a separate repository ([boxel-skills](https://github.com/cardstack/boxel-skills)) to enable independent versioning and deployment.

## Architecture

- **Skills Source**: Skills are stored in the [boxel-skills](https://github.com/cardstack/boxel-skills) repository
- **Local Development**: Skills are cloned into `packages/skills-realm/contents/` for local editing
- **Skills Writer User**: A special `skills_writer` Matrix user has permissions to edit skills in the realm
- **Deployment Pipeline**: Changes flow from local development → boxel-skills repo → staging → production

## Setup

### Prerequisites

Make sure you have completed the standard Boxel setup as described in the [main README](../../README.md), including:

- Matrix server running
- Postgres database
- Host app and realm server

### Initial Skills Setup

If you have started from scratch these should have been automatically run for you, but they are safe to run again.

1. **Clone the skills repository** (automatically done with `start:all` or `start:development` in the realm-server package):

   ```bash
   cd packages/skills-realm
   pnpm skills:setup
   ```

2. **Register the skills writer user**:

   ```bash
   cd packages/matrix
   pnpm register-skills-writer
   ```

   This creates a Matrix user with credentials:

   - Username: `skills_writer`
   - Password: `password`

## Skills Management Scripts

The skills realm package includes helper scripts for managing the skills repository:

| Script               | Description                                                             |
| -------------------- | ----------------------------------------------------------------------- |
| `pnpm skills:setup`  | Clones the boxel-skills repository into `contents/` if it doesn't exist |
| `pnpm skills:update` | Pulls latest changes from the boxel-skills repository                   |
| `pnpm skills:reset`  | Removes the `contents/` directory and re-clones the repository          |

## Development Workflows

### Local Skills Development

This workflow is ideal for rapid iteration and testing of skills:

1. **Log in as skills_writer** in the Boxel interface using the credentials above

   - Using a different browser profile or incognito window allow you to edit and test at the same time

2. **Edit skills directly** in the Boxel interface:

   - Navigate to the skills realm
   - Create or modify skills using the visual editor
   - Changes are automatically saved to `packages/skills-realm/contents/`

3. **Test your changes** immediately in the live environment

4. **Commit and push** when satisfied:

   ```bash
   cd packages/skills-realm/contents
   git checkout -b your-feature-branch
   git add .
   git commit -m "Add new skill or modify existing skill"
   git push origin your-feature-branch
   ```

5. **Create a Pull Request** in the [boxel-skills](https://github.com/cardstack/boxel-skills) repository

6. **Deploy to staging** happens automatically when the PR is merged

7. **Tag the commit** to release to production

## Deployment Pipeline

1. **Development**: Edit skills locally or remotely
2. **Pull Request**: Submit changes to boxel-skills repository
3. **Review**: Code review process in GitHub
4. **Merge**: Changes automatically deployed to staging
5. **Tag**: Create a git tag to trigger production deployment

## Troubleshooting

### Skills not appearing after changes

- Ensure the skills realm server is running (`pnpm start:all` in `packages/realm-server`)
- Check that you're logged in as `skills_writer`
- Verify the `contents/` directory exists and has the latest skills

### Permission denied when editing skills

- Confirm you're logged in as the `skills_writer` user
- Check that the user was created correctly: `pnpm register-skills-writer` in `packages/matrix`

### Skills repository out of sync

- Run `pnpm skills:update` to pull latest changes
- For a complete reset: `pnpm skills:reset`
