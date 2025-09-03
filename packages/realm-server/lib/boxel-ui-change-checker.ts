import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';

function calculateDirectoryChecksum(dirPath: string): string {
  const shaCommand = os.platform() === 'darwin' ? 'shasum -a 256' : 'sha256sum';
  const command = `cd "${dirPath}" && find . -type f -exec ${shaCommand} {} \\; | sort | ${shaCommand}`;
  const result = execSync(command, { encoding: 'utf8' });
  return result.split(' ')[0]; // Extract just the checksum part
}

export function compareCurrentChecksum() {
  console.log('__dirname:', __dirname);
  console.log('process.cwd():', process.cwd());

  const boxelUiPath = path.join(
    process.cwd(),
    '/../host/node_modules/@cardstack/boxel-ui/src',
  );
  const currentChecksum = calculateDirectoryChecksum(boxelUiPath);

  // Read from file, don't throw if it doesn't exist
  let previousChecksum = '';
  try {
    previousChecksum = fs.readFileSync(
      path.join(process.cwd(), 'boxel-ui-checksum.txt'),
      'utf8',
    );
  } catch (error) {
    // File doesn't exist or can't be read
    // Create file with the checksum
    fs.writeFileSync(
      path.join(process.cwd(), 'boxel-ui-checksum.txt'),
      currentChecksum,
    );
  }

  return {
    previousChecksum: previousChecksum,
    currentChecksum: currentChecksum,
  };
}
