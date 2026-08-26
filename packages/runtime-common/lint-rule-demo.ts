// TEMPORARY. Exists only to show `no-url-from-realm-identifier` failing a CI
// lint job, and is raised to `error` for this one file in this package's
// eslintrc so that these are the only errors in the run. Revert the commit that
// added it.
import { rri, type RealmResourceIdentifier } from './realm-identifiers.ts';

// The plain case: `RealmResourceIdentifier` is a branded string, so this
// typechecks, and fails only once the realm is reached through a registered
// prefix.
export function urlFromIdentifier(): URL {
  let cardApi = rri('@cardstack/base/card-api');
  return new URL(cardApi);
}

// The brand-erasing case, which is the shape the defect takes in real code: the
// ternary's type is plain `string`, because a branded string is a subtype of
// `string` and the union of the two reduces. The argument carries no brand of
// its own, and only walking the branches — through the `const` to its
// initializer — finds it.
export function urlFromErasedIdentifier(
  moduleId: RealmResourceIdentifier,
): URL {
  const withExtension = moduleId.endsWith('.gts')
    ? moduleId
    : `${moduleId}.gts`;
  return new URL(withExtension);
}
