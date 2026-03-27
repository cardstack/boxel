export function uniqueDeps(
  ...groups: Array<Iterable<string> | undefined>
): string[] {
  let deps = new Set<string>();
  for (let group of groups) {
    if (!group) {
      continue;
    }
    for (let dep of group) {
      deps.add(dep);
    }
  }
  return [...deps];
}
