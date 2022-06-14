export const externalsMap: Map<string, string[]>;
export function traverse(
  dirHandle: FileSystemDirectoryHandle,
  path: string,
  opts?: { create?: boolean }
): Promise<{ handle: FileSystemDirectoryHandle; filename: string }>;
