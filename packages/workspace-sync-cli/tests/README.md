# Workspace Sync CLI Integration Tests

This directory contains integration tests for the workspace-sync-cli that verify the push/pull functionality between local directories and Boxel workspaces.

## Prerequisites

Before running the tests, ensure the following services are running:

1. **PostgreSQL Test Instance** (port 5435)
   ```bash
   # From the root directory
   pnpm start:pg:test
   ```
   Note: The tests use a separate PostgreSQL instance on port 5435 to avoid conflicts with development databases.

2. **Matrix Server** (port 8008)
   ```bash
   # From the root directory
   pnpm start:matrix
   ```

   Or start both test services together:
   ```bash
   # From the root directory
   pnpm start:test:prereqs
   ```

3. **Build the CLI**
   ```bash
   cd workspace-sync-cli
   pnpm build
   ```

## Running the Tests

```bash
cd workspace-sync-cli
pnpm test
```

For debugging output:
```bash
DEBUG=1 pnpm test
```

## What the Tests Cover

1. **Pull Operations**
   - Downloading files from realm to local directory
   - Respecting file ignore patterns (dotfiles)
   - Preserving directory structure

2. **Push Operations**
   - Uploading files from local to realm
   - Modifying existing files
   - Adding new files

3. **Command Options**
   - `--delete`: Removes extra files in destination
   - `--dry-run`: Preview changes without applying them

4. **Ignore Patterns**
   - `.boxelignore` file support
   - Pattern matching for files and directories

## Test Architecture

The tests work by:
1. Creating temporary directories for testing
2. Starting an isolated realm server instance with both a worker manager and realm server
3. Running push/pull commands against the test realm
4. Verifying the expected file operations occurred
5. Cleaning up all temporary resources

The test infrastructure:
- Realm server runs on port 4205
- Worker manager runs on port 4212
- Uses a unique test database for each run
- Mimics the isolated-realm-server setup used in other tests