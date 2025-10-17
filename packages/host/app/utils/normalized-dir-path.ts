export function normalizeDirPath(entryPath: string): string {
  return entryPath.endsWith('/') ? entryPath : `${entryPath}/`;
}
