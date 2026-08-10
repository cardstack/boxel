import {
  CardDef,
  field,
  contains,
  Component,
} from '@cardstack/base/card-api';
import { JsonField } from '@cardstack/base/json-field';
import StringField from '@cardstack/base/string';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { eq } from '@cardstack/boxel-ui/helpers';

// The version lock: one card that decides which build of `palette` every card
// in this realm gets.
//
// The pin the user moves is `version`. `imports` is the machine-readable half
// that the host actually reads — straight off `attributes`, without ever
// loading this class — while `version` is the half a person can hold in their
// head. Neither has to compromise for the other.
//
// `imports` is STORED, not computed, and that is not an implementation
// detail. The host reads this card as a file rather than as an index row,
// because it is needed *while* the realm is being indexed and cannot wait for
// the index that would contain it. A computed field does not exist until the
// card has been evaluated, so a computed `imports` is invisible to a reader
// holding only the bytes. Writing both fields together keeps the pins as data
// at rest: anything that can read the realm can read them.
//
// The addresses it produces are content-addressed and immutable. Nothing is
// copied and nothing is rewritten when the pin moves: both builds are sitting
// there at their own permanent URLs, and this card only chooses which one the
// word `palette` means.
export class VersionLock extends CardDef {
  static displayName = 'Version Lock';

  // `pinnedVersion`, not `version`: a plain `version` field read back as
  // undefined, which points at a name already spoken for on the base class.
  // The demo cannot afford that particular confusion — a lock whose own
  // display disagrees with the pin it wrote is worse than no lock.
  @field pinnedVersion = contains(StringField);

  @field imports = contains(JsonField);

  static isolated = class Isolated extends Component<typeof VersionLock> {
    private versions = [
      { id: '1.0.0', note: 'three colours, pick(index)' },
      { id: '2.0.0', note: 'five colours, pick(name)' },
    ];

    // No invented default. An unset pin shows as unset; it must not display a
    // version the realm is not actually resolving to.
    private get current() {
      return this.args.model.pinnedVersion;
    }

    private get resolved() {
      return this.args.model.imports?.palette ?? 'nothing pinned yet';
    }

    // Both halves move together, in one save. The human-facing pin and the
    // map the host reads are two views of one decision, so letting them drift
    // apart would mean the card says one thing and the realm does another.
    private choose = (v: string) => {
      this.args.model.pinnedVersion = v;
      this.args.model.imports = {
        palette: `/_packages/lib/palette@${v}/index.js`,
      };
    };

    <template>
      <section class='lock'>
        <header>
          <h2>palette</h2>
          <p>Every card in this workspace resolves <code>palette</code> to the
            build selected here.</p>
        </header>

        <div class='choices' role='group' aria-label='palette version'>
          {{#each this.versions as |v|}}
            <button
              type='button'
              class='choice {{if (eq v.id this.current) "on"}}'
              aria-pressed='{{if (eq v.id this.current) "true" "false"}}'
              {{on 'click' (fn this.choose v.id)}}
            >
              <span class='v'>{{v.id}}</span>
              <span class='note'>{{v.note}}</span>
            </button>
          {{/each}}
        </div>

        <footer>
          <span class='label'>resolves to</span>
          {{! The stored map, not a string rebuilt from the pin. Printing a
              reconstruction here once let the card claim a version the realm
              was not using. }}
          <code class='resolved'>{{this.resolved}}</code>
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
      </style>
    </template>
  };
}
