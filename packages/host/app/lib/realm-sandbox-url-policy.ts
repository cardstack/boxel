export function assertURLWithinRealm(realmURL: string, targetURL: string): URL {
  let realm = new URL(realmURL);
  let target = new URL(targetURL);
  let realmPath = realm.pathname.endsWith('/')
    ? realm.pathname
    : `${realm.pathname}/`;

  if (
    target.origin !== realm.origin ||
    !target.pathname.startsWith(realmPath)
  ) {
    throw new Error(
      `Denied cross-realm access from ${realm.href} to ${target.href}`,
    );
  }

  return target;
}
