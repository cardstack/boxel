import { RealmSyncBase, validateMatrixEnvVars } from './realm-sync-base';
import * as fs from 'fs';

interface PushOptions {
  realmUrl: string;
  localDir: string;
  deleteRemote?: boolean;
  dryRun?: boolean;
}

class RealmPusher extends RealmSyncBase {
  constructor(
    private pushOptions: PushOptions,
    matrixUrl: string,
    username: string,
    password: string,
  ) {
    super(pushOptions, matrixUrl, username, password);
  }

  async sync() {
    console.log(
      `Starting push from ${this.options.localDir} to ${this.options.realmUrl}`,
    );

    // Test authentication by trying to access the realm root first
    console.log('Testing realm access...');
    try {
      await this.getRemoteFileList(''); // Test with empty path (root)
    } catch (error) {
      console.error('Failed to access realm:', error);
      throw new Error(
        'Cannot proceed with push: Authentication or access failed. ' +
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

    // Upload local files
    for (const [relativePath, localPath] of localFiles) {
      try {
        await this.uploadFile(relativePath, localPath);
      } catch (error) {
        console.error(`Error uploading ${relativePath}:`, error);
      }
    }

    // Delete remote files that don't exist locally (if requested)
    if (this.pushOptions.deleteRemote) {
      const filesToDelete = new Set(remoteFiles.keys());
      for (const relativePath of localFiles.keys()) {
        filesToDelete.delete(relativePath);
      }

      if (filesToDelete.size > 0) {
        console.log(
          `Will delete ${filesToDelete.size} remote files that don't exist locally`,
        );
      }

      for (const relativePath of filesToDelete) {
        // Skip metadata files
        if (relativePath === '.realm.json' || relativePath.startsWith('.')) {
          continue;
        }

        try {
          await this.deleteFile(relativePath);
        } catch (error) {
          console.error(`Error deleting ${relativePath}:`, error);
        }
      }
    }

    console.log('Push completed');
  }
}

function parseArgs(): {
  realmUrl: string;
  localDir: string;
  deleteRemote: boolean;
  dryRun: boolean;
} {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: realm-push <LOCAL_DIR> <REALM_URL> [OPTIONS]

Arguments:
  LOCAL_DIR   The local directory containing files to sync
  REALM_URL   The URL of the target realm (e.g., https://demo.cardstack.com/demo/)

Options:
  --delete    Delete remote files that don't exist locally
  --dry-run   Show what would be done without making changes
  --help, -h  Show this help message

Environment Variables (required):
  MATRIX_URL       The Matrix server URL
  MATRIX_USERNAME  Your Matrix username  
  MATRIX_PASSWORD  Your Matrix password

File Filtering:
  - Files starting with a dot (.) are always ignored
  - Files matching patterns in .gitignore are ignored
  - Files matching patterns in .boxelignore are ignored (realm-specific)
  - .boxelignore allows you to exclude files from realm sync while keeping them in git

Examples:
  realm-push ./my-cards https://demo.cardstack.com/demo/
  realm-push ./my-cards https://demo.cardstack.com/demo/ --delete --dry-run
`);
    process.exit(0);
  }

  if (args.length < 2) {
    console.error('Error: LOCAL_DIR and REALM_URL are required arguments');
    console.error('Run with --help for usage information');
    process.exit(1);
  }

  const localDir = args[0];
  const realmUrl = args[1];
  const deleteRemote = args.includes('--delete');
  const dryRun = args.includes('--dry-run');

  return { realmUrl, localDir, deleteRemote, dryRun };
}

async function main() {
  // Parse command line arguments
  const { realmUrl, localDir, deleteRemote, dryRun } = parseArgs();

  // Get environment variables for Matrix authentication
  const { matrixUrl, username, password } = validateMatrixEnvVars();

  if (!fs.existsSync(localDir)) {
    console.error(`Local directory does not exist: ${localDir}`);
    process.exit(1);
  }

  try {
    const pusher = new RealmPusher(
      { realmUrl, localDir, deleteRemote, dryRun },
      matrixUrl,
      username,
      password,
    );

    await pusher.initialize();
    await pusher.sync();

    console.log('Push completed successfully');
  } catch (error) {
    console.error('Push failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
