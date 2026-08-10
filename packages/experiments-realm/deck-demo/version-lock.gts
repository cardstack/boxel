import { CardDef, Component, realmURL } from '@cardstack/base/card-api';
import { tracked } from '@glimmer/tracking';
import { restartableTask } from 'ember-concurrency';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { eq } from '@cardstack/boxel-ui/helpers';
import ReadTextFileTool from '@cardstack/boxel-host/tools/read-text-file';
import WriteTextFileTool from '@cardstack/boxel-host/tools/write-text-file';
import type Owner from '@ember/owner';

// Declared at module scope rather than inline as `static isolated = class …`.
// A decorator is not valid in a class expression, and this component needs
// `@tracked` for the state it reads off disk.
class VersionLockIsolated extends Component<typeof VersionLock> {
  private versions = [
    { id: '1.0.0', note: 'three colours, pick(index)' },
    { id: '2.0.0', note: 'five colours, pick(name)' },
  ];

  // The map as last read from disk. `loaded` distinguishes "still reading"
  // from "nothing pinned" — a control that showed an unset pin while still
  // reading would invite a click that overwrites a pin the user never saw.
  @tracked private pinnedURL: string | undefined;
  @tracked private loaded = false;
  @tracked private error: string | undefined;

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.load.perform();
  }

  private get realm(): string | undefined {
    return this.args.model[realmURL]?.href;
  }

  // Derived from the URL rather than stored beside it. There is exactly one
  // fact here — what `palette` resolves to — and a second field holding
  // "which version that is" could only ever disagree with it.
  private get current(): string | undefined {
    let match = this.pinnedURL?.match(/palette@([^/]+)\//);
    return match?.[1];
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
      // A realm with no map yet is the ordinary starting state, not a
      // failure — writing one is how it stops being that.
      return {};
    }
  }

  private load = restartableTask(async () => {
    this.error = undefined;
    let map = await this.readMap();
    this.pinnedURL = map?.imports?.palette;
    this.loaded = true;
  });

  private choose = (version: string) => {
    this.write.perform(version);
  };

  // Read-modify-write, not blind overwrite. The map may carry `scopes`, a
  // vendor key, or pins for libraries this control knows nothing about, and a
  // switcher that dropped them would silently unpin the rest of the realm.
  private write = restartableTask(async (version: string) => {
    let commandContext = this.args.context?.commandContext;
    if (!commandContext || !this.realm) {
      this.error = 'No writable realm in context.';
      return;
    }
    this.error = undefined;
    let map = await this.readMap();
    let url = `/_packages/lib/palette@${version}/index.js`;
    map.imports = { ...(map.imports ?? {}), palette: url };
    try {
      await new WriteTextFileTool(commandContext).execute({
        realm: this.realm,
        path: 'importmap.json',
        content: `${JSON.stringify(map, null, 2)}\n`,
        overwrite: true,
      });
      this.pinnedURL = url;
    } catch (e: any) {
      this.error = String(e?.message ?? e);
    }
  });

  private get busy() {
    return this.write.isRunning || this.load.isRunning;
  }

  <template>
    <section class='lock'>
      <header>
        <h2>palette</h2>
        <p>Every card in this workspace resolves <code>palette</code> to the
          build selected here. The selection lives in
          <code>importmap.json</code>
          — this control reads and writes that file, and keeps no copy of it.</p>
      </header>

      <div class='choices' role='group' aria-label='palette version'>
        {{#each this.versions as |v|}}
          <button
            type='button'
            class='choice {{if (eq v.id this.current) "on"}}'
            aria-pressed='{{if (eq v.id this.current) "true" "false"}}'
            disabled={{this.busy}}
            {{on 'click' (fn this.choose v.id)}}
            data-test-choose-version={{v.id}}
          >
            <span class='v'>{{v.id}}</span>
            <span class='note'>{{v.note}}</span>
          </button>
        {{/each}}
      </div>

      <footer>
        <span class='label'>importmap.json says</span>
        {{#if this.loaded}}
          <code class='resolved' data-test-resolved>
            {{#if this.pinnedURL}}{{this.pinnedURL}}{{else}}nothing pinned
              yet{{/if}}
          </code>
        {{else}}
          <code class='resolved'>reading…</code>
        {{/if}}
        {{#if this.error}}
          <p class='error' role='status'>{{this.error}}</p>
        {{/if}}
      </footer>
    </section>

    <style scoped>
      .lock {
        padding: 1.5rem;
        font: 400 15px/1.5 system-ui, sans-serif;
        max-width: 34rem;
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
        grid-template-columns: 1fr 1fr;
        gap: 0.75rem;
        margin: 1.25rem 0;
      }
      .choice {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        align-items: flex-start;
        padding: 0.85rem 1rem;
        border: 2px solid #d8d8d8;
        border-radius: 0.6rem;
        background: #fff;
        cursor: pointer;
        text-align: left;
      }
      .choice:hover {
        border-color: #999;
      }
      .choice:disabled {
        cursor: progress;
        opacity: 0.7;
      }
      .choice.on {
        border-color: #0090ff;
        background: #f0f8ff;
      }
      .v {
        font-family: ui-monospace, monospace;
        font-weight: 600;
      }
      .note {
        font-size: 0.8rem;
        color: #666;
      }
      footer {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
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
        font-size: 0.8rem;
        color: #333;
        word-break: break-all;
      }
      .error {
        margin: 0;
        color: #b91c1c;
        font-size: 0.85rem;
      }
    </style>
  </template>
}

// The version lock: one control that decides which build of `palette` every
// card in this realm gets.
//
// This card STORES NOTHING. The realm's `importmap.json` is the truth, and
// this is a preset switcher over it — it reads the file to show what is
// pinned and writes the file to change it. That is the shape
// `deck-multi-package-design.md` §3 rules for any authoring surface over the
// map: "The card is a convenience, never a dependency. An agent can write
// `importmap.json` directly, and the protocol is satisfied."
//
// The earlier version of this card kept the pins in its own fields and the
// host read them out of the card document. That worked, and it was still
// wrong: it made every module in the realm depend on a card being parseable.
// A card that keeps its own copy of the map can disagree with the map, and
// when it does, the card is the one lying.
//
// The addresses it writes are content-addressed and immutable. Nothing is
// copied and nothing is rewritten when the pin moves: both builds sit at
// their own permanent URLs, and this only chooses which one the word
// `palette` means.
export class VersionLock extends CardDef {
  static displayName = 'Version Lock';

  static isolated = VersionLockIsolated;
}
