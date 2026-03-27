import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const sharedRuntimeDir = join(tmpdir(), 'software-factory-runtime');
export const defaultSupportMetadataFile = join(
  sharedRuntimeDir,
  'support.json',
);

export function getSupportMetadataFile() {
  return (
    process.env.SOFTWARE_FACTORY_SUPPORT_METADATA_FILE ??
    process.env.SOFTWARE_FACTORY_METADATA_FILE ??
    defaultSupportMetadataFile
  );
}

export function readSupportMetadata():
  | {
      context?: Record<string, unknown>;
      pid?: number;
      realmDir?: string;
      templateDatabaseName?: string;
    }
  | undefined {
  let metadataFile = getSupportMetadataFile();
  if (!existsSync(metadataFile)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(metadataFile, 'utf8')) as {
      context?: Record<string, unknown>;
      pid?: number;
      realmDir?: string;
      templateDatabaseName?: string;
    };
  } catch (error) {
    throw new Error(
      `Unable to parse software-factory support metadata at ${metadataFile}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function readSupportContext(): Record<string, unknown> | undefined {
  return readSupportMetadata()?.context;
}

export function writeSupportMetadata(payload: unknown): void {
  let metadataFile = getSupportMetadataFile();
  let tempFile = join(
    dirname(metadataFile),
    `.support.${process.pid}.${Date.now()}.tmp`,
  );

  writeFileSync(tempFile, JSON.stringify(payload, null, 2));
  renameSync(tempFile, metadataFile);
}
