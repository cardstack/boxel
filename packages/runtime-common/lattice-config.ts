// Operator configuration, shared by server adapters. An authored card or
// request header cannot opt a realm into additional computation or publication.
export class LatticeRealmConfig {
  readonly #enabledRealms: ReadonlySet<string>;

  constructor(realms: readonly string[] = []) {
    this.#enabledRealms = new Set(
      realms.map((realm) => {
        let url = new URL(realm);
        if (
          !['http:', 'https:'].includes(url.protocol) ||
          !url.pathname.endsWith('/') ||
          url.search ||
          url.hash ||
          url.username ||
          url.password
        ) {
          throw new Error(`Expected an exact HTTP realm root: ${realm}`);
        }
        return url.href;
      }),
    );
  }

  static parse(value: string | undefined): LatticeRealmConfig {
    if (value === undefined || value === '') return new LatticeRealmConfig();
    let realms: unknown = JSON.parse(value);
    if (
      !Array.isArray(realms) ||
      !realms.every((realm) => typeof realm === 'string')
    ) {
      throw new Error(
        'LATTICE_ENABLED_REALMS must be a JSON array of realm URLs',
      );
    }
    return new LatticeRealmConfig(realms);
  }

  isEnabled(realm: URL | string): boolean {
    return this.#enabledRealms.has(
      typeof realm === 'string' ? realm : realm.href,
    );
  }

  // Return a detached, immutable snapshot for adapters that bind the policy in
  // SQL. Neither an adapter nor a job can add realms to the operator's policy.
  get enabledRealms(): readonly string[] {
    return Object.freeze([...this.#enabledRealms]);
  }
}
