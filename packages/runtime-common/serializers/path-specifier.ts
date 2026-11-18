import type {
  BaseDefConstructor,
  BaseInstanceType,
} from '@cardstack/base/card-api';

// A path specifier's prefixes, stored as written: a JSON array of strings
// such as `["blog/", "posts/"]`. See `../path-specifier.ts` for what a prefix
// means.
//
// The prefixes are never parsed, trimmed or otherwise canonicalized here;
// what the author wrote is what reads back. Whether each prefix is valid is
// decided where the specifier is used, so a card holding an invalid prefix,
// such as `["blog/*"]`, still loads and can be corrected in its editor.
//
// The value's shape is checked here. An unset specifier is `null`, and an
// empty list means no path limit, so a value that is present but malformed
// must not collapse to either. Anything other than an array of strings, such
// as the bare string `"blog/"`, is refused rather than read as absent: the
// card holding it doesn't load or index until its JSON is corrected. It isn't
// wrapped into a list either: until the card was saved again, its stored JSON
// would still hold a string where every other reader expects a list (ADR 037
// §1.6).
export type SerializedPathSpecifier = string[];

export function queryableValue(value: unknown): string[] | null {
  return asPrefixes(value);
}

export function serialize(value: unknown): SerializedPathSpecifier | null {
  return asPrefixes(value);
}

export async function deserialize<T extends BaseDefConstructor>(
  this: T,
  value: unknown,
): Promise<BaseInstanceType<T>> {
  return asPrefixes(value) as BaseInstanceType<T>;
}

// Reads a specifier's prefixes, or `null` when it is unset. The list is
// copied, so a caller can't change a stored value through the result.
export function asPrefixes(value: unknown): string[] | null {
  if (value == null) {
    return null;
  }
  if (!Array.isArray(value)) {
    throw new Error(
      `a path specifier must be a list of path prefixes, but is ${typeof value}`,
    );
  }
  let index = value.findIndex((prefix) => typeof prefix !== 'string');
  if (index !== -1) {
    throw new Error(
      `a path specifier's prefixes must be strings, but the one at index ${index} is ${
        value[index] === null ? 'null' : typeof value[index]
      }`,
    );
  }
  return [...(value as string[])];
}
