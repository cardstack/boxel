// Instance dependencies historically use both canonical .json file URLs and
// extensionless card IDs. Keep publication matching and the ready frontier on
// the same two spellings; module/CSS URLs must not become owner identities.
const extension = '.json';
export function latticeDependencyAliases(url: string): string[] {
  return url.endsWith(extension)
    ? [url, url.slice(0, -extension.length)]
    : [url];
}

// column is engine-authored SQL, never an authored URL or request value.
export function latticeDependencyAliasSQL(column: string): string {
  return `substr(${column},1,length(${column})-${extension.length})`;
}
