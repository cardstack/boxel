import { CardDef, Component, realmURL } from '@cardstack/base/card-api';
import { tracked } from '@glimmer/tracking';
import { restartableTask, timeout } from 'ember-concurrency';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { eq } from '@cardstack/boxel-ui/helpers';
import ReadTextFileTool from '@cardstack/boxel-host/tools/read-text-file';
import WriteTextFileTool from '@cardstack/boxel-host/tools/write-text-file';
import type Owner from '@ember/owner';

const PACKAGE = 'lib/palette';
const SPECIFIER = 'palette';
// How often the live follower re-asks what the newest version is. The listing
// is a cheap uncached read of one JSON file; the cost of asking is far below
// the cost of showing a pin that moved minutes ago.
const FOLLOW_INTERVAL_MS = 4000;

interface PublishedVersion {
  version: string;
  treeHash: string;
  publishedAt?: string;
}

// Declared at module scope rather than inline as `static isolated = class …`:
// a decorator is not valid in a class expression, and this needs `@tracked`.
class VersionLockIsolated extends Component<typeof VersionLock> {
  // What the store says exists, newest first. Discovered, never hardcoded —
  // that is the point of the listing endpoint. Publish a new version to the
  // running server and it appears here without this card being edited.
  @tracked private versions: PublishedVersion[] = [];
  // The pin currently in `importmap.json`, and the intent beside it.
  @tracked private pinnedURL: string | undefined;
  @tracked private follow: string | undefined;
  @tracked private loaded = false;
  @tracked private error: string | undefined;

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.load.perform();
  }

  private get realm(): string | undefined {
    return this.args.model[realmURL]?.href;
  }

  private get isLive(): boolean {
    return this.follow === 'live';
  }

  // Which version the pin currently resolves to, read out of the URL rather
  // than stored beside it. There is one fact here — what `palette` means —
  // and a second field holding "which version that is" could only disagree.
  private get current(): string | undefined {
    return this.pinnedURL?.match(/palette@([^/]+)\//)?.[1];
  }

  private get newest(): PublishedVersion | undefined {
    return this.versions[0];
  }

  // The identity to display. A Version's real name is its tree hash — the
  // content it seals. A semver is a LABEL pointing at that content, and while
  // following live the label is exactly the thing that keeps moving, so
  // naming the seal is the honest answer to "what am I running right now?".
  private get sealId(): string | undefined {
    return this.versions.find((v) => v.version === this.current)?.treeHash;
  }

  private get shortSeal(): string | undefined {
    return this.sealId?.slice(0, 12);
  }

  private urlFor(version: string): string {
    return `/_packages/${PACKAGE}@${version}/index.js`;
  }

  private async fetchVersions(): Promise<PublishedVersion[]> {
    if (!this.realm) {
      return [];
    }
    // The package store is served by the realm SERVER, at its origin — it is
    // not inside any realm — so this asks the origin the realm sits on.
    let listing = new URL(`/_packages/${PACKAGE}`, this.realm).href;
    let response = await fetch(listing, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`${listing} answered ${response.status}`);
    }
    let body = await response.json();
    return Array.isArray(body?.versions) ? body.versions : [];
  }

  private async readMap(): Promise<Record<string, any>> {
    let commandContext = this.args.context?.commandContext;
    if (!commandContext || !this.realm) {
      return {};
    }
    try {
      let { content } = await new ReadTextFileTool(commandContext).execute({
        realm: this.realm,
        path: 'importmap.json',
      });
      return JSON.parse(content ?? '{}') ?? {};
    } catch {
      // A realm with no map yet is the ordinary starting state.
      return {};
    }
  }

  private load = restartableTask(async () => {
    this.error = undefined;
    try {
      this.versions = await this.fetchVersions();
    } catch (e: any) {
      this.error = String(e?.message ?? e);
    }
    let map = await this.readMap();
    this.pinnedURL = map?.imports?.[SPECIFIER];
    this.follow = map?.boxel?.dependencies?.[SPECIFIER];
    this.loaded = true;
    if (this.isLive) {
      this.followLive.perform();
    }
  });

  private choose = (version: string) => {
    this.write.perform(version);
  };

  // Read-modify-write, never blind overwrite. The map may carry scopes, an
  // `extends`, or pins for libraries this control knows nothing about, and a
  // switcher that dropped them would silently unpin the rest of the realm.
  //
  // TWO FACTS ARE WRITTEN, and they are not the same fact. `imports` gets a
  // CONCRETE pin, always — resolution must never depend on a marker this card
  // invented, and an import map with `"live"` in it would not be an import
  // map. The vendor key records the INTENT: `live` means "whatever is newest",
  // an exact version means "this one, until I say otherwise". That is Deck's
  // own split — dependencies are ranges, imports are the lock — and it is why
  // a reader that knows nothing about this card still resolves correctly.
  private write = restartableTask(async (version: string) => {
    let commandContext = this.args.context?.commandContext;
    if (!commandContext || !this.realm) {
      this.error = 'No writable realm in context.';
      return;
    }
    this.error = undefined;
    let live = version === 'live';
    let target = live ? this.newest?.version : version;
    if (!target) {
      this.error = 'Nothing is published yet, so there is nothing to follow.';
      return;
    }
    let map = await this.readMap();
    let url = this.urlFor(target);
    map.imports = { ...(map.imports ?? {}), [SPECIFIER]: url };
    map.boxel = {
      ...(map.boxel ?? {}),
      dependencies: {
        ...(map.boxel?.dependencies ?? {}),
        [SPECIFIER]: live ? 'live' : target,
      },
    };
    try {
      await new WriteTextFileTool(commandContext).execute({
        realm: this.realm,
        path: 'importmap.json',
        content: `${JSON.stringify(map, null, 2)}\n`,
        overwrite: true,
      });
      this.pinnedURL = url;
      this.follow = live ? 'live' : target;
    } catch (e: any) {
      this.error = String(e?.message ?? e);
      return;
    }
    if (live) {
      this.followLive.perform();
    } else {
      this.followLive.cancelAll();
    }
  });

  // Following live is a WRITE loop, not a display trick. The pin in the map
  // is what every other card in the realm resolves through, so "keep the
  // palette up to date" has to mean moving that pin — showing a newer number
  // while the realm still loads the old bytes would be the lie this whole
  // demo exists to avoid.
  private followLive = restartableTask(async () => {
    while (this.isLive && !this.isDestroying && !this.isDestroyed) {
      await timeout(FOLLOW_INTERVAL_MS);
      if (!this.isLive) {
        return;
      }
      try {
        let latest = await this.fetchVersions();
        this.versions = latest;
        let tip = latest[0];
        if (tip && this.current !== tip.version) {
          // A new version landed. Move the pin, which propagates the same way
          // any other edit to the map does.
          await this.write.perform('live');
        }
      } catch (e: any) {
        // A failed poll is not worth surfacing — the next one is four seconds
        // away, and a transient blip should not paint an error over a
        // perfectly good pin.
      }
    }
  });

  private get busy() {
    return this.write.isRunning || this.load.isRunning;
  }

  <template>
    <section class='lock'>
      <header>
        <h2>palette</h2>
        <p>Every card in this workspace resolves <code>palette</code> through
          <code>importmap.json</code>. This control reads and writes that file
          and keeps no copy of it. The versions below are whatever the realm
          server's package store actually holds — publish another and it shows
          up here.</p>
      </header>

      <div class='choices' role='group' aria-label='palette version'>
        <button
          type='button'
          class='choice live {{if this.isLive "on"}}'
          aria-pressed='{{if this.isLive "true" "false"}}'
          disabled={{this.busy}}
          {{on 'click' (fn this.choose 'live')}}
          data-test-choose-version='live'
        >
          <span class='v'>live</span>
          <span class='note'>follow whatever is newest</span>
        </button>

        {{#each this.versions as |v|}}
          <button
            type='button'
            class='choice {{if (eq v.version this.follow) "on"}}'
            aria-pressed='{{if (eq v.version this.follow) "true" "false"}}'
            disabled={{this.busy}}
            {{on 'click' (fn this.choose v.version)}}
            data-test-choose-version={{v.version}}
          >
            <span class='v'>{{v.version}}</span>
            <span class='note seal'>{{v.treeHash}}</span>
          </button>
        {{/each}}
      </div>

      <footer>
        {{#if this.loaded}}
          {{#if this.isLive}}
            {{! Following live: the label is the thing that moves, so name the
                seal instead. }}
            <span class='label'>following live · sealed as</span>
            <code class='resolved' data-test-resolved>
              {{#if this.shortSeal}}{{this.shortSeal}}{{else}}nothing published
                yet{{/if}}
            </code>
            <span class='sub'>currently {{this.current}}</span>
          {{else}}
            <span class='label'>pinned to</span>
            <code class='resolved' data-test-resolved>
              {{#if this.current}}{{this.current}}{{else}}nothing pinned yet{{/if}}
            </code>
          {{/if}}
        {{else}}
          <span class='label'>reading</span>
          <code class='resolved'>…</code>
        {{/if}}
        {{#if this.error}}
          <p class='error' role='status'>{{this.error}}</p>
        {{/if}}
      </footer>
    </section>

    <style scoped>
      /* Light, like the swatches card beside it. The container is a neutral
         surface: everything that changes between versions is the library's
         output, so the chrome stays constant and out of the way. */
      .lock {
        padding: 1.5rem;
        font: 400 15px/1.5 system-ui, sans-serif;
        max-width: 36rem;
      }
      h2 {
        margin: 0;
        font-size: 1.4rem;
        font-family: ui-monospace, monospace;
      }
      header p {
        margin: 0.35rem 0 0;
        color: #666;
        font-size: 0.9rem;
      }
      .choices {
        display: grid;
        gap: 0.6rem;
        margin: 1.25rem 0;
      }
      .choice {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        align-items: flex-start;
        padding: 0.7rem 0.9rem;
        border: 2px solid #d8d8d8;
        border-radius: 0.6rem;
        background: #fff;
        cursor: pointer;
        text-align: left;
      }
      .choice:hover {
        border-color: #999;
      }
      /* Kept from the dark pass, which is the one thing there worth keeping:
         this control is fully keyboard-operable and deserves a ring that does
         not depend on the browser default surviving a restyle. */
      .choice:focus-visible {
        outline: 2px solid #0090ff;
        outline-offset: 2px;
      }
      .choice:disabled {
        cursor: progress;
        opacity: 0.7;
      }
      .choice.on {
        border-color: #0090ff;
        background: #f0f8ff;
      }
      .choice.live .v {
        color: #0a7d3f;
      }
      .v {
        font-family: ui-monospace, monospace;
        font-weight: 600;
      }
      .note {
        font-size: 0.8rem;
        color: #666;
      }
      .note.seal {
        font-family: ui-monospace, monospace;
        font-size: 0.68rem;
        color: #999;
        word-break: break-all;
      }
      footer {
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        padding-top: 1rem;
        border-top: 1px solid #eee;
      }
      .label {
        font-size: 0.75rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #888;
      }
      .resolved {
        font-family: ui-monospace, monospace;
        font-size: 0.85rem;
        color: #333;
        word-break: break-all;
      }
      .sub {
        font-size: 0.75rem;
        color: #999;
      }
      .error {
        margin: 0;
        color: #b91c1c;
        font-size: 0.85rem;
      }
    </style>
  </template>
}

// The version lock: one control over which build of `palette` every card in
// this realm gets.
//
// It STORES NOTHING. The realm's `importmap.json` is the truth; this reads it
// to show what is pinned and writes it to change it. That is the shape
// `deck-multi-package-design.md` §3 rules for any authoring surface over the
// map — "the card is a convenience, never a dependency."
//
// The list is discovered, not declared. `GET /_packages/lib/palette` reports
// what the store holds, so publishing a new version to the running server
// makes it appear here with no edit to this file.
//
// LIVE IS A REAL CHOICE, not a display mode. Deck's dependency vocabulary has
// three levels of volatility — `live` (every save), a dist-tag, and an exact
// pin — and this offers the two ends of it. Following live moves the pin as
// new versions land, and names the state by its SEAL rather than its semver,
// because while following, the semver is precisely the part that keeps
// changing underneath you.
export class VersionLock extends CardDef {
  static displayName = 'Version Lock';

  static isolated = VersionLockIsolated;
}
