import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';

function calculateDirectoryChecksum(dirPath: string): string {
  const shaCommand = os.platform() === 'darwin' ? 'shasum -a 256' : 'sha256sum';
  const command = `cd "${dirPath}" && find . -type f -print0 | sort -z | xargs -0 cat | ${shaCommand}`;
  const result = execSync(command, { encoding: 'utf8' });
  return result.split(' ')[0].trim(); // Extract just the checksum part and remove newlines
}

// This function is used to compare the current checksum of the boxel-ui
// directory with the previous checksum. We use it to detect whether a reindex
// is needed after the deploy pipeline has finished. This is to make sure the
// prerendered content is up to date with components, helpers,... imported from
// boxel-ui.
export function compareCurrentBoxelUIChecksum() {
  const boxelUiPath = path.join(
    process.cwd(),
    '/../host/node_modules/@cardstack/boxel-ui/src',
  );

  if (!fs.existsSync(boxelUiPath)) {
    throw new Error(
      `The boxel-ui change checker failed to find the boxel-ui path: ${boxelUiPath}`,
    );
  }

  const currentChecksum = calculateDirectoryChecksum(boxelUiPath);

  let previousChecksum = '';

  let persistentPath = path.join(process.cwd(), '/../../../persistent');
  if (!fs.existsSync(persistentPath)) {
    throw new Error(
      `The boxel-ui change checker expects 'persistent' path to exist but it doesn't: ${persistentPath}`,
    );
  }
  let filePath = path.join(
    process.cwd(),
    '/../../../persistent/boxel-ui-checksum.txt',
  );
  try {
    previousChecksum = fs.readFileSync(filePath, 'utf8').trim();
  } catch (error) {
    // File doesn't exist or can't be read
    // Create file with the checksum
    fs.writeFileSync(filePath, currentChecksum);
  }

  return {
    previousChecksum,
    currentChecksum,
  };
}
