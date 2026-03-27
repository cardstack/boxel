import { RealmSyncBase, validateMatrixEnvVars } from './realm-sync-base';
import * as fs from 'fs';

interface PushOptions {
  workspaceUrl: string;
  localDir: string;
  deleteRemote?: boolean;
  dryRun?: boolean;
}

class RealmPusher extends RealmSyncBase {
  hasError = false;
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
      `Starting push from ${this.options.localDir} to ${this.options.workspaceUrl}`,
    );

    // Test authentication by trying to access the workspace root first
    console.log('Testing workspace access...');
    try {
      await this.getRemoteFileList(''); // Test with empty path (root)
    } catch (error) {
      console.error('Failed to access workspace:', error);
      throw new Error(
        'Cannot proceed with push: Authentication or access failed. ' +
          'Please check your Matrix credentials and workspace permissions.',
      );
    }
    console.log('Workspace access verified');

    // Get current remote file listing
    const remoteFiles = await this.getRemoteFileList();
    console.log(`Found ${remoteFiles.size} files in remote workspace`);

    // Get local file listing
    const localFiles = await this.getLocalFileList();
    console.log(`Found ${localFiles.size} files in local directory`);

    // Upload local files
    for (const [relativePath, localPath] of localFiles) {
      try {
        await this.uploadFile(relativePath, localPath);
      } catch (error) {
        this.hasError = true;
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
  workspaceUrl: string;
  localDir: string;
  deleteRemote: boolean;
  dryRun: boolean;
} {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: workspace-push <LOCAL_DIR> <WORKSPACE_URL> [OPTIONS]

Arguments:
  LOCAL_DIR     The local directory containing files to sync
  WORKSPACE_URL The URL of the target workspace (e.g., https://demo.cardstack.com/demo/)

Options:
  --delete    Delete remote files that don't exist locally
  --dry-run   Show what would be done without making changes
  --help, -h  Show this help message

Environment Variables (required):
  MATRIX_URL       The Matrix server URL
  MATRIX_USERNAME  Your Matrix username  
  MATRIX_PASSWORD  Your Matrix password (or use REALM_SECRET_SEED for realm users)
  
Environment Variables (optional):
  REALM_SECRET_SEED  Secret for generating realm user credentials. If MATRIX_USERNAME
                     is omitted, it will be derived from WORKSPACE_URL:
                       /<owner>/<endpoint>/  -> realm/<owner>_<endpoint>
                       /base/, /skills/, ... -> <slug>_realm
                       /published/<id>/      -> realm/published_<id>

File Filtering:
  - Files starting with a dot (.) are always ignored
  - Files matching patterns in .gitignore are ignored
  - Files matching patterns in .boxelignore are ignored (workspace-specific)
  - .boxelignore allows you to exclude files from workspace sync while keeping them in git

Examples:
  workspace-push ./my-cards https://demo.cardstack.com/demo/
  workspace-push ./my-cards https://demo.cardstack.com/demo/ --delete --dry-run
`);
    process.exit(0);
  }

  if (args.length < 2) {
    console.error('Error: LOCAL_DIR and WORKSPACE_URL are required arguments');
    console.error('Run with --help for usage information');
    process.exit(1);
  }

  const localDir = args[0];
  const workspaceUrl = args[1];
  const deleteRemote = args.includes('--delete');
  const dryRun = args.includes('--dry-run');

  return { workspaceUrl, localDir, deleteRemote, dryRun };
}

async function main() {
  // Parse command line arguments
  const { workspaceUrl, localDir, deleteRemote, dryRun } = parseArgs();

  // Get environment variables for Matrix authentication
  const { matrixUrl, username, password } =
    await validateMatrixEnvVars(workspaceUrl);

  if (!fs.existsSync(localDir)) {
    console.error(`Local directory does not exist: ${localDir}`);
    process.exit(1);
  }

  try {
    const pusher = new RealmPusher(
      { workspaceUrl, localDir, deleteRemote, dryRun },
      matrixUrl,
      username,
      password,
    );

    await pusher.initialize();
    await pusher.sync();

    if (pusher.hasError) {
      console.log('Push did not complete successfully. view logs for details');
      process.exit(2);
    } else {
      console.log('Push completed successfully');
    }
  } catch (error) {
    console.error('Push failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
