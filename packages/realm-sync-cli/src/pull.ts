import { RealmSyncBase, validateMatrixEnvVars } from './realm-sync-base';
import * as fs from 'fs';
import * as path from 'path';

interface PullOptions {
  realmUrl: string;
  localDir: string;
  deleteLocal?: boolean;
  dryRun?: boolean;
}

class RealmPuller extends RealmSyncBase {
  constructor(
    private pullOptions: PullOptions,
    matrixUrl: string,
    username: string,
    password: string,
  ) {
    super(pullOptions, matrixUrl, username, password);
  }

  async sync() {
    console.log(
      `Starting pull from ${this.options.realmUrl} to ${this.options.localDir}`,
    );

    // Test authentication by trying to access the realm root first
    console.log('Testing realm access...');
    try {
      await this.getRemoteFileList(''); // Test with empty path (root)
    } catch (error) {
      console.error('Failed to access realm:', error);
      throw new Error(
        'Cannot proceed with pull: Authentication or access failed. ' +
          'Please check your Matrix credentials and realm permissions.',
      );
    }
    console.log('Realm access verified');

    // Get current remote file listing
    const remoteFiles = await this.getRemoteFileList();
    console.log(`Found ${remoteFiles.size} files in remote realm`);

    // Get local file listing
    const localFiles = await this.getLocalFileList();
    console.log(`Found ${localFiles.size} files in local directory`);

    // Create local directory if it doesn't exist
    if (!fs.existsSync(this.options.localDir)) {
      if (this.options.dryRun) {
        console.log(
          `[DRY RUN] Would create directory: ${this.options.localDir}`,
        );
      } else {
        fs.mkdirSync(this.options.localDir, { recursive: true });
        console.log(`Created directory: ${this.options.localDir}`);
      }
    }

    // Download remote files
    for (const [relativePath] of remoteFiles) {
      // Skip metadata files
      if (relativePath === '.realm.json' || relativePath.startsWith('.')) {
        continue;
      }

      try {
        const localPath = path.join(this.options.localDir, relativePath);
        await this.downloadFile(relativePath, localPath);
      } catch (error) {
        console.error(`Error downloading ${relativePath}:`, error);
      }
    }

    // Delete local files that don't exist remotely (if requested)
    if (this.pullOptions.deleteLocal) {
      const filesToDelete = new Set(localFiles.keys());
      for (const relativePath of remoteFiles.keys()) {
        filesToDelete.delete(relativePath);
      }

      if (filesToDelete.size > 0) {
        console.log(
          `Will delete ${filesToDelete.size} local files that don't exist in realm`,
        );
      }

      for (const relativePath of filesToDelete) {
        // Skip metadata files
        if (relativePath === '.realm.json' || relativePath.startsWith('.')) {
          continue;
        }

        try {
          const localPath = localFiles.get(relativePath);
          if (localPath) {
            await this.deleteLocalFile(localPath);
          }
        } catch (error) {
          console.error(`Error deleting local file ${relativePath}:`, error);
        }
      }
    }

    console.log('Pull completed');
  }
}

function parseArgs(): {
  realmUrl: string;
  localDir: string;
  deleteLocal: boolean;
  dryRun: boolean;
} {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: realm-pull <REALM_URL> <LOCAL_DIR> [OPTIONS]

Arguments:
  REALM_URL   The URL of the source realm (e.g., https://demo.cardstack.com/demo/)
  LOCAL_DIR   The local directory to sync files to

Options:
  --delete    Delete local files that don't exist in the realm
  --dry-run   Show what would be done without making changes
  --help, -h  Show this help message

Environment Variables (required):
  MATRIX_URL       The Matrix server URL
  MATRIX_USERNAME  Your Matrix username  
  MATRIX_PASSWORD  Your Matrix password

Examples:
  realm-pull https://demo.cardstack.com/demo/ ./my-cards
  realm-pull https://demo.cardstack.com/demo/ ./my-cards --delete --dry-run
`);
    process.exit(0);
  }

  if (args.length < 2) {
    console.error('Error: REALM_URL and LOCAL_DIR are required arguments');
    console.error('Run with --help for usage information');
    process.exit(1);
  }

  const realmUrl = args[0];
  const localDir = args[1];
  const deleteLocal = args.includes('--delete');
  const dryRun = args.includes('--dry-run');

  return { realmUrl, localDir, deleteLocal, dryRun };
}

async function main() {
  // Parse command line arguments
  const { realmUrl, localDir, deleteLocal, dryRun } = parseArgs();

  // Get environment variables for Matrix authentication
  const { matrixUrl, username, password } = validateMatrixEnvVars();

  try {
    const puller = new RealmPuller(
      { realmUrl, localDir, deleteLocal, dryRun },
      matrixUrl,
      username,
      password,
    );

    await puller.initialize();
    await puller.sync();

    console.log('Pull completed successfully');
  } catch (error) {
    console.error('Pull failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
