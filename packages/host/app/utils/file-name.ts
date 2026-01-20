export async function findNonConflictingFilename(
  fileUrl: string,
  fileExists: (fileUrl: string) => Promise<boolean>,
): Promise<string> {
  let maxAttempts = 100;
  let { baseName, extension } = parseFilename(fileUrl);

  for (let counter = 1; counter < maxAttempts; counter++) {
    let candidateUrl = `${baseName}-${counter}${extension}`;
    let exists = await fileExists(candidateUrl);

    if (!exists) {
      return candidateUrl;
    }
  }

  return `${baseName}-${maxAttempts}${extension}`;
}

function parseFilename(fileUrl: string): {
  baseName: string;
  extension: string;
} {
  let extensionMatch = fileUrl.match(/\.([^.]+)$/);
  let extension = extensionMatch?.[0] || '';
  let baseName = fileUrl.replace(/\.([^.]+)$/, '');

  return { baseName, extension };
}
