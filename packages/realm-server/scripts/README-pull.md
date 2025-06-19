# Pull Script

This script allows you to synchronize files from a Boxel realm to a local directory. It can download all files from the realm and optionally delete local files that don't exist in the realm.

## Usage

```bash
pnpm pull <REALM_URL> <LOCAL_DIR> [OPTIONS]
```

### Arguments

- `REALM_URL` - The URL of the source realm (e.g., `https://demo.cardstack.com/demo/`)
- `LOCAL_DIR` - The local directory to sync files to (e.g., `./my-cards`)

### Options

- `--delete` - Delete local files that don't exist in the realm
- `--dry-run` - Show what would be done without making changes
- `--help`, `-h` - Show help message

### Required Environment Variables

- `MATRIX_URL` - The Matrix server URL (e.g., `https://matrix.cardstack.com`)
- `MATRIX_USERNAME` - Your Matrix username (e.g., `@user:cardstack.com`)
- `MATRIX_PASSWORD` - Your Matrix password

## Examples

### Basic sync (download only)

```bash
export MATRIX_URL="https://matrix.cardstack.com"
export MATRIX_USERNAME="@user:cardstack.com"
export MATRIX_PASSWORD="your-password"

pnpm pull https://demo.cardstack.com/demo/ ./my-cards
```

### Sync with deletion of local files

```bash
pnpm pull https://demo.cardstack.com/demo/ ./my-cards --delete
```

### Dry run (preview changes)

```bash
pnpm pull https://demo.cardstack.com/demo/ ./my-cards --dry-run
```

### Combined flags

```bash
pnpm pull https://demo.cardstack.com/demo/ ./my-cards --delete --dry-run
```

## How it works

1. **Authentication**: The script logs into Matrix using the provided environment variables
2. **Realm Authentication**: It then authenticates with the source realm using the Matrix session
3. **File Discovery**: It scans both the remote realm and the local directory to get file listings
4. **Download**: All files from the realm are downloaded to the local directory (overwriting existing files)
5. **Deletion** (optional): If `--delete` flag is used, local files that don't exist in the realm are deleted

## Notes

- The script skips hidden files (starting with `.`) from the realm
- The script preserves directory structure
- The local directory will be created if it doesn't exist
- All files are downloaded as text files with UTF-8 encoding
- The script will not download realm metadata files like `.realm.json`
- Use `--dry-run` to preview what changes would be made before actually running the sync
- Use `--help` to see usage information

## Troubleshooting

- Make sure your Matrix credentials are correct and you have permission to read from the source realm
- Ensure the realm URL ends with a `/`
- Check that you have write permissions to the local directory
- If you get authentication errors, verify your Matrix server URL and credentials
- Run with `--help` for usage information
