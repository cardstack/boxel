import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

export const sharedRuntimeDir = join(tmpdir(), 'software-factory-runtime');
export const templateMetadataDir = join(
  tmpdir(),
  'software-factory-template-cache',
);
export const defaultSupportMetadataFile = join(
  sharedRuntimeDir,
  'support.json',
);

export interface PreparedTemplateMetadata {
  realmDir: string;
  templateDatabaseName: string;
  templateRealmURL: string;
  templateRealmServerURL: string;
  cacheHit?: boolean;
  cacheMissReason?: string;
  /** When set, this template covers multiple realm fixtures. */
  coveredRealmDirs?: string[];
}

export function getSupportMetadataFile() {
  return (
    process.env.TEST_HARNESS_SUPPORT_METADATA_FILE ??
    process.env.TEST_HARNESS_METADATA_FILE ??
    defaultSupportMetadataFile
  );
}

export function readSupportMetadata():
  | {
      context?: Record<string, unknown>;
      pid?: number;
      realmDir?: string;
      templateDatabaseName?: string;
      templateRealmURL?: string;
      templateRealmServerURL?: string;
      preparedTemplates?: PreparedTemplateMetadata[];
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
      templateRealmURL?: string;
      templateRealmServerURL?: string;
      preparedTemplates?: PreparedTemplateMetadata[];
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

function getTemplateMetadataFile(templateDatabaseName: string): string {
  return join(templateMetadataDir, `${templateDatabaseName}.json`);
}

export function readPreparedTemplateMetadata(
  templateDatabaseName: string,
): PreparedTemplateMetadata | undefined {
  let metadataFile = getTemplateMetadataFile(templateDatabaseName);
  if (!existsSync(metadataFile)) {
    return undefined;
  }

  try {
    return JSON.parse(
      readFileSync(metadataFile, 'utf8'),
    ) as PreparedTemplateMetadata;
  } catch (error) {
    throw new Error(
      `Unable to parse software-factory template metadata at ${metadataFile}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

// Write JSON to a sibling temp file and rename it into place. A reader
// polling for the file with existsSync + readFileSync would otherwise be
// able to observe the target mid-write — created but not yet fully
// written — and parse a truncated prefix (`Unexpected end of JSON
// input`). A rename within a directory is atomic on the same filesystem,
// so the reader sees either no file or the complete payload, never a
// partial one. The pid+timestamp suffix keeps concurrent writers from
// colliding on the temp path.
export function writeMetadataFileAtomically(
  metadataFile: string,
  payload: unknown,
): void {
  mkdirSync(dirname(metadataFile), { recursive: true });
  let tempFile = join(
    dirname(metadataFile),
    `.${basename(metadataFile)}.${process.pid}.${Date.now()}.tmp`,
  );
  writeFileSync(tempFile, JSON.stringify(payload, null, 2));
  renameSync(tempFile, metadataFile);
}

export function writePreparedTemplateMetadata(
  payload: PreparedTemplateMetadata,
): void {
  writeMetadataFileAtomically(
    getTemplateMetadataFile(payload.templateDatabaseName),
    payload,
  );
}

export function writeSupportMetadata(payload: unknown): void {
  writeMetadataFileAtomically(getSupportMetadataFile(), payload);
}
