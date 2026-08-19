// The parser lives in runtime-common so non-base consumers (e.g. the ai-bot
// prompt assembly) can share it; re-exported here for base-internal imports.
// Imported via the runtime-common root, which the module loader shims —
// unregistered subpath imports do not resolve inside the base realm.
export {
  parseFrontmatter,
  type ParsedFrontmatter,
} from '@cardstack/runtime-common';
