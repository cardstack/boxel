export const externalsMap: Map<string, string[]>;
export function traverse(
  dirHandle: FileSystemDirectoryHandle,
  path: string
): Promise<{ handle: FileSystemDirectoryHandle; filename: string }>;
