# Push Script

This script allows you to synchronize files from a local directory to a Boxel realm. It can upload new/changed files and optionally delete files from the realm that don't exist locally.

## Usage

```bash
pnpm push <LOCAL_DIR> <REALM_URL> [OPTIONS]
```

### Arguments

- `LOCAL_DIR` - The local directory containing files to sync (e.g., `./my-cards`)
- `REALM_URL` - The URL of the target realm (e.g., `https://demo.cardstack.com/demo/`)

### Options

- `--delete` - Delete remote files that don't exist locally
- `--dry-run` - Show what would be done without making changes
- `--help`, `-h` - Show help message

### Required Environment Variables

- `MATRIX_URL` - The Matrix server URL (e.g., `https://matrix.cardstack.com`)
- `MATRIX_USERNAME` - Your Matrix username (e.g., `@user:cardstack.com`)
- `MATRIX_PASSWORD` - Your Matrix password

## Examples

### Basic sync (upload only)

```bash
export MATRIX_URL="https://matrix.cardstack.com"
export MATRIX_USERNAME="@user:cardstack.com"
export MATRIX_PASSWORD="your-password"

pnpm push ./my-cards https://demo.cardstack.com/demo/
```

### Sync with deletion of remote files

```bash
pnpm push ./my-cards https://demo.cardstack.com/demo/ --delete
```

### Dry run (preview changes)

```bash
pnpm push ./my-cards https://demo.cardstack.com/demo/ --dry-run
```

### Combined flags

```bash
pnpm push ./my-cards https://demo.cardstack.com/demo/ --delete --dry-run
```

## How it works

1. **Authentication**: The script logs into Matrix using the provided environment variables
2. **Realm Authentication**: It then authenticates with the target realm using the Matrix session
3. **File Discovery**: It scans both the local directory and the remote realm to get file listings
4. **Upload**: All files from the local directory are uploaded to the realm (overwriting existing files)
5. **Deletion** (optional): If `--delete` flag is used, files that exist in the realm but not locally are deleted

## Notes

- The script skips hidden files (starting with `.`) in the local directory
- The script preserves directory structure
- All files are uploaded as text files with UTF-8 encoding
- The script will not delete realm metadata files like `.realm.json`
- Use `--dry-run` to preview what changes would be made before actually running the sync
- Use `--help` to see usage information

## Troubleshooting

- Make sure your Matrix credentials are correct and you have permission to write to the target realm
- Ensure the realm URL ends with a `/`
- Check that the local directory exists and contains the files you want to sync
- If you get authentication errors, verify your Matrix server URL and credentials
- Run with `--help` for usage information
