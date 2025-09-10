import fs from 'fs';
import path from 'path';

const fileChecksumPath = path.join(
  process.cwd(),
  '/../../../persistent/boxel-ui-checksum.txt', // A folder that persists between deployments (AWS EFS)
);

async function fetchCurrentBoxelUIChecksum(distURL: URL): Promise<string> {
  const response = await fetch(new URL('/boxel-ui-checksum.txt', distURL));

  if (!response.ok) {
    throw new Error(
      `Failed to fetch boxel-ui checksum: ${response.statusText}`,
    );
  }

  return await response.text();
}

// This function is used to compare the current checksum of the boxel-ui
// directory with the previous checksum. We use it to detect whether a reindex
// is needed after the deploy pipeline has finished. This is to make sure the
// prerendered content is up to date with anything imported from boxel-ui.
export async function compareCurrentBoxelUIChecksum(distURL: URL) {
  const currentChecksum = await fetchCurrentBoxelUIChecksum(distURL);

  let previousChecksum = '';

  let persistentPath = path.join(process.cwd(), '/../../../persistent');
  if (!fs.existsSync(persistentPath)) {
    throw new Error(
      `The boxel-ui change checker expects 'persistent' path to exist but it doesn't: ${persistentPath}`,
    );
  }

  try {
    previousChecksum = fs.readFileSync(fileChecksumPath, 'utf8').trim();
  } catch (error) {
    // File doesn't exist or can't be read
    // Create file with the checksum
    writeCurrentBoxelUIChecksum(currentChecksum);
  }

  return {
    previousChecksum,
    currentChecksum,
  };
}

export function writeCurrentBoxelUIChecksum(checksum: string) {
  fs.writeFileSync(fileChecksumPath, checksum);
}
