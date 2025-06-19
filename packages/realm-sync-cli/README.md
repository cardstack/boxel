# Realm Sync CLI

CLI tools for syncing files between local directories and Boxel realms.

## Installation

This package provides two CLI commands for syncing files with Boxel realms:

- `realm-push` - Upload files from a local directory to a realm
- `realm-pull` - Download files from a realm to a local directory

## Authentication

Both commands require Matrix credentials to authenticate with the realm:

```bash
export MATRIX_URL="https://matrix.cardstack.com"
export MATRIX_USERNAME="your-username"
export MATRIX_PASSWORD="your-password"
```

## Commands

### realm-push

Uploads files from a local directory to a realm.

```bash
realm-push <LOCAL_DIR> <REALM_URL> [OPTIONS]
```

**Arguments:**

- `LOCAL_DIR` - The local directory containing files to sync
- `REALM_URL` - The URL of the target realm (e.g., https://demo.cardstack.com/demo/)

**Options:**

- `--delete` - Delete remote files that don't exist locally
- `--dry-run` - Show what would be done without making changes
- `--help, -h` - Show help message

**Examples:**

```bash
realm-push ./my-cards https://demo.cardstack.com/demo/
realm-push ./my-cards https://demo.cardstack.com/demo/ --delete --dry-run
```

### realm-pull

Downloads files from a realm to a local directory.

```bash
realm-pull <REALM_URL> <LOCAL_DIR> [OPTIONS]
```

**Arguments:**

- `REALM_URL` - The URL of the source realm (e.g., https://demo.cardstack.com/demo/)
- `LOCAL_DIR` - The local directory to sync files to

**Options:**

- `--delete` - Delete local files that don't exist in the realm
- `--dry-run` - Show what would be done without making changes
- `--help, -h` - Show help message

**Examples:**

```bash
realm-pull https://demo.cardstack.com/demo/ ./my-cards
realm-pull https://demo.cardstack.com/demo/ ./my-cards --delete --dry-run
```

## Development

From the package directory:

```bash
# Run push script directly
pnpm push <LOCAL_DIR> <REALM_URL> [OPTIONS]

# Run pull script directly
pnpm pull <REALM_URL> <LOCAL_DIR> [OPTIONS]

# Build the package
pnpm build

# Lint the code
pnpm lint
```

## Features

- Recursive directory syncing
- Skip hidden files and directories (starting with `.`)
- Safe authentication testing before destructive operations
- Detailed logging of all operations
- Dry-run mode for testing
- Robust URL handling (works with or without trailing slashes)
