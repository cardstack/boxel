import type { PublicationReceipt } from '@cardstack/runtime-common/lattice-materialization';
import type { LatticePublicationEvent } from '@cardstack/runtime-common/lattice-publication-outbox';

export const LATTICE_NOTICE_IDENTITY_LIMIT = 256;

interface RealmNotices {
  versions: Map<string, number>;
  discardedThrough?: number;
}

// Delivery evidence for identities a read has not discovered yet. Keep only
// the latest version per identity, not event payloads or a replay history.
// Overflow loses precision, never the obligation to confirm a pending view.
export default class LatticePublicationNotices {
  private realms = new Map<string, RealmNotices>();

  constructor(private canonicalize: (id: string) => string) {}

  get size(): number {
    let total = 0;
    for (let notices of this.realms.values()) total += notices.versions.size;
    return total;
  }

  record(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    let event = value as Partial<LatticePublicationEvent>;
    // This marker is emitted by the enabled publication outbox. Ordinary
    // source/index events must not allocate or maintain this index.
    if (
      event.eventName !== 'index' ||
      event.indexType !== 'incremental' ||
      typeof event.publicationId !== 'string' ||
      !event.publicationId.length ||
      event.publicationId.length > 128 ||
      typeof event.realmURL !== 'string' ||
      !Number.isSafeInteger(event.generation) ||
      event.generation! < 1 ||
      !Array.isArray(event.invalidations)
    )
      return;
    let realm: string;
    let urls: string[];
    try {
      realm = this.canonicalize(event.realmURL);
      let root = new URL(realm);
      if (
        !['http:', 'https:'].includes(root.protocol) ||
        root.search ||
        root.hash ||
        !realm.endsWith('/')
      )
        return;
      urls = event.invalidations.map((id) => {
        if (typeof id !== 'string')
          throw new Error('Invalid publication identity');
        let url = this.canonicalize(id);
        let parsed = new URL(url);
        if (
          !url.startsWith(realm) ||
          url === realm ||
          parsed.search ||
          parsed.hash
        )
          throw new Error('Publication identity is outside its realm');
        return url;
      });
    } catch {
      return;
    }
    if (!urls.length) return;
    let notices = this.realms.get(realm);
    if (!notices) this.realms.set(realm, (notices = { versions: new Map() }));
    for (let url of urls) {
      let previous = notices.versions.get(url);
      if (previous !== undefined && previous >= event.generation!) continue;
      notices.versions.delete(url);
      notices.versions.set(url, event.generation!);
      if (notices.versions.size > LATTICE_NOTICE_IDENTITY_LIMIT) {
        let [discarded, generation] = notices.versions.entries().next().value!;
        notices.versions.delete(discarded);
        notices.discardedThrough = Math.max(
          notices.discardedThrough ?? 0,
          generation,
        );
      }
    }
  }

  needsRead(
    realm: string,
    url: string,
    stamp: Pick<
      PublicationReceipt,
      'validatedThrough' | 'outputRevision' | 'state'
    >,
  ): boolean {
    let notices = this.realms.get(this.canonicalize(realm));
    if (!notices) return false;
    let observed = Math.max(
      notices.versions.get(this.canonicalize(url)) ?? -1,
      notices.discardedThrough ?? -1,
    );
    if (observed < 0) return false;
    // Both are serving-realm generations. Equal-output publication can
    // advance validated inputs while keeping the older output generation.
    let supplied = Math.max(stamp.validatedThrough, stamp.outputRevision ?? 0);
    return (
      observed > supplied ||
      (stamp.state === 'pending' && observed === supplied)
    );
  }

  forget(realm: string) {
    this.realms.delete(this.canonicalize(realm));
  }

  clear() {
    this.realms.clear();
  }
}
