import { mkdirSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

export function writeRuntimeMetadataFile(
  runtimeMetadataFile: string | undefined,
  tempFilePrefix: string,
  payload: unknown,
): void {
  if (!runtimeMetadataFile) {
    return;
  }

  mkdirSync(dirname(runtimeMetadataFile), { recursive: true });
  let tempFile = join(
    dirname(runtimeMetadataFile),
    `.${tempFilePrefix}.${process.pid}.${Date.now()}.tmp`,
  );
  writeFileSync(tempFile, JSON.stringify(payload, null, 2));
  renameSync(tempFile, runtimeMetadataFile);
}
