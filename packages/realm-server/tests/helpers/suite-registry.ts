// How a shard decides which tests run.
//
// Every test file under tests/ is loaded by tests/index.ts, found by the same
// directory walk that assigns files to shards. `buildModuleFilter` then
// narrows what *runs*, by module name, to the files a shard was assigned:
// every shard parses every file and runs only its own modules.
//
// The filter fails silently. A module whose title it cannot express reports no
// tests, and a suite missing tests passes exactly like one that ran them — so
// tests/shard-assignment-test.ts checks that the filter selects every
// top-level module title declared in the suite.

export function parseModules(value: string): string[] {
  return value
    .split(/[|,]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.replace(/^['"]+|['"]+$/g, ''));
}

// Matches a test's full name — `<module>: <test>` for a test declared
// directly in a module, `<module> > <nested> > …: <test>` below that — against
// the files this shard owns.
//
// The trailing group is what makes the match a whole module name rather than a
// prefix, so `info-test.ts` does not also select `info-test-helpers.ts`. It
// has to admit every separator that can follow a file name in a module title:
//
//   `:`      the test sits directly in the file's module
//   ` > `    it sits in a module nested inside it
//   ` | `    the file declares several top-level modules, distinguished by a
//            qualifier (`node-realm-test.ts | file stat probing`)
//
// Without the third, a qualified module matches nothing and runs nowhere.
export function buildModuleFilter(modulesToMatch: string[]): string {
  const escaped = modulesToMatch.map((moduleName) => escapeRegex(moduleName));
  const pattern = `^(?:${escaped.join('|')})(?:\\s>\\s|:|\\s\\|\\s)`;
  return `/${pattern}/`;
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\//g, '\\/');
}
