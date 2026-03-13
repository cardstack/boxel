import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sharedRuntimeDir = join(tmpdir(), 'software-factory-runtime');
export const defaultSupportMetadataFile = join(
  sharedRuntimeDir,
  'support.json',
);

export function getSupportMetadataFile() {
  return (
    process.env.SOFTWARE_FACTORY_SUPPORT_METADATA_FILE ??
    defaultSupportMetadataFile
  );
}

export function readSupportContext(): Record<string, unknown> | undefined {
  let metadataFile = getSupportMetadataFile();
  if (!existsSync(metadataFile)) {
    return undefined;
  }

  let metadata = JSON.parse(readFileSync(metadataFile, 'utf8')) as {
    context?: Record<string, unknown>;
  };

  return metadata.context;
}
