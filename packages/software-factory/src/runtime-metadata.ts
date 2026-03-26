import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

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
}

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

export function writePreparedTemplateMetadata(
  payload: PreparedTemplateMetadata,
): void {
  mkdirSync(templateMetadataDir, { recursive: true });
  let metadataFile = getTemplateMetadataFile(payload.templateDatabaseName);
  let tempFile = join(
    dirname(metadataFile),
    `.template.${process.pid}.${Date.now()}.tmp`,
  );
  writeFileSync(tempFile, JSON.stringify(payload, null, 2));
  renameSync(tempFile, metadataFile);
}

export function writeSupportMetadata(payload: unknown): void {
  let metadataFile = getSupportMetadataFile();
  mkdirSync(dirname(metadataFile), { recursive: true });
  let tempFile = join(
    dirname(metadataFile),
    `.support.${process.pid}.${Date.now()}.tmp`,
  );

  writeFileSync(tempFile, JSON.stringify(payload, null, 2));
  renameSync(tempFile, metadataFile);
}
