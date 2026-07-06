// The parser lives in runtime-common so non-base consumers (e.g. the ai-bot
// prompt assembly) can share it; re-exported here for base-internal imports.
export {
  parseFrontmatter,
  type ParsedFrontmatter,
} from '@cardstack/runtime-common/frontmatter-parse';
