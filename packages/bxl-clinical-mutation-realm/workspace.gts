import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import {
  CardDef,
  Component,
  contains,
  field,
  linksToMany,
  realmURL,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class Workspace extends CardDef {
  static displayName = 'BXL Clinical Access Workspace';
  static prefersWideFormat = true;

  @field entryPoints = linksToMany(CardDef);
  @field mutationScenarios = linksToMany(CardDef);
  @field purpose = contains(StringField);
  @field cardTitle = contains(StringField, {
    computeVia: function () {
      return 'BXL Clinical Access';
    },
  });

  static isolated = class extends Component<typeof Workspace> {
    openCard = (card: CardDef) => {
      this.args.viewCard?.(card, 'isolated');
    };

    openScenario = () => {
      let base = this.args.model[realmURL] as URL | undefined;
      if (base) {
        this.args.viewCard?.(new URL('SCENARIO.md', base), 'isolated', {
          type: 'file',
        });
      }
    };

    get entries() {
      return (this.args.model.entryPoints ?? []).filter(Boolean);
    }

    get scenarios() {
      return (this.args.model.mutationScenarios ?? []).filter(Boolean);
    }

    <template>
      <article class='workspace'>
        <header class='hero'>
          <div class='brand'><span>N</span><strong>NORTHSTAR MEDICAL</strong></div>
          <p class='eyebrow'>BXL AUTHORIZATION SHOWCASE</p>
          <h1>Patient access,<br />made visible.</h1>
          <p class='summary'>A compact hospital realm where relationship data
            and BXL statements decide which patient-dashboard sections and
            clinical actions exist for each viewer.</p>
          <button type='button' {{on 'click' this.openScenario}}>Read the
            scenario and access matrix →</button>
        </header>

        <main>
          <div class='section-heading mutation-heading'>
            <div><span>BXL MUTATION LAB</span><h2>One atlas, 10 operations</h2></div>
            <p>Open one wide card, choose an operation from its table of
              contents, and watch the exact Matrix-invalidated target remain
              visible at right.</p>
          </div>
          <div class='entry-list mutation-list'>
            {{#each this.scenarios as |entry|}}
              <button
                type='button'
                class='entry'
                {{on 'click' (fn this.openCard entry)}}
              >
                <span class='number'>01–10</span>
                <span class='entry-copy'><strong
                  >{{entry.cardTitle}}</strong><small
                  >{{entry.cardDescription}}</small></span>
                <span class='arrow'>↗</span>
              </button>
            {{/each}}
          </div>

          <div class='section-heading'>
            <div><span>LIVE RECORDS</span><h2>Choose a patient dashboard</h2></div>
            <p>Each record uses the same policy but carries its own attending,
              care-team, pharmacy, billing, and suspension relationships.</p>
          </div>
          <div class='entry-list'>
            {{#each this.entries as |entry index|}}
              <button
                type='button'
                class='entry'
                {{on 'click' (fn this.openCard entry)}}
              >
                <span class='number'>0{{index}}</span>
                <span class='entry-copy'><strong
                  >{{entry.cardTitle}}</strong><small
                  >{{entry.cardDescription}}</small></span>
                <span class='arrow'>↗</span>
              </button>
            {{/each}}
          </div>
        </main>

        <footer>
          <span>SYNCHRONOUS · HOST-NEUTRAL · FINITE SNAPSHOT</span>
          <span>Authorization returns yes/no. Clinical commands own execution.</span>
        </footer>
      </article>

      <style scoped>
        .workspace,
        .workspace * {
          box-sizing: border-box;
        }
        .workspace {
          width: 100%;
          min-height: 100%;
          background: var(--background);
          color: var(--foreground);
          font-family: var(--font-sans);
        }
        .hero {
          min-height: 410px;
          display: grid;
          align-content: center;
          justify-items: start;
          padding: 42px clamp(24px, 7vw, 88px);
          border-bottom: 1px solid var(--clinical-rule-strong);
          background: linear-gradient(
            105deg,
            var(--clinical-navy) 0 72%,
            var(--clinical-accent-soft) 72%
          );
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 46px;
        }
        .brand > span {
          width: 36px;
          height: 36px;
          display: grid;
          place-items: center;
          background: var(--primary);
          color: var(--primary-foreground);
          font: 800 17px var(--font-serif);
        }
        .brand strong {
          font: 700 11px var(--font-mono);
          letter-spacing: 0.1em;
        }
        .eyebrow,
        .section-heading span {
          margin: 0 0 10px;
          color: var(--primary);
          font: 700 10px var(--font-mono);
          letter-spacing: 0.12em;
        }
        h1 {
          margin: 0;
          font: 560 clamp(44px, 8vw, 78px)/0.92 var(--font-serif);
          letter-spacing: -0.055em;
        }
        .summary {
          max-width: 690px;
          margin: 20px 0 0;
          color: var(--clinical-copy);
          font-size: 16px;
          line-height: 1.6;
        }
        .hero button {
          margin-top: 24px;
          padding: 0;
          border: 0;
          border-bottom: 1px solid var(--primary);
          background: transparent;
          color: var(--primary);
          font: 650 12px/2 var(--font-sans);
          cursor: pointer;
        }
        main {
          padding: 30px clamp(24px, 7vw, 88px) 44px;
        }
        .mutation-heading {
          margin-top: 0.5rem;
        }
        .mutation-list {
          margin-bottom: 3rem;
        }
        .section-heading {
          display: flex;
          align-items: end;
          justify-content: space-between;
          gap: 30px;
          padding-bottom: 18px;
          border-bottom: 1px solid var(--clinical-rule-strong);
        }
        .section-heading h2 {
          margin: 4px 0 0;
          font: 600 27px var(--font-serif);
        }
        .section-heading p {
          max-width: 480px;
          margin: 0;
          color: var(--muted-foreground);
          font-size: 12px;
          line-height: 1.5;
        }
        .entry-list {
          border-bottom: 1px solid var(--clinical-rule-strong);
        }
        .entry {
          width: 100%;
          display: grid;
          grid-template-columns: 54px minmax(0, 1fr) auto;
          align-items: center;
          gap: 18px;
          padding: 17px 0;
          border: 0;
          border-bottom: 1px solid var(--border);
          background: transparent;
          color: var(--foreground);
          text-align: left;
          cursor: pointer;
        }
        .entry:hover {
          color: var(--primary);
        }
        .number {
          color: var(--muted-foreground);
          font: 700 10px var(--font-mono);
        }
        .entry-copy {
          display: grid;
          gap: 4px;
        }
        .entry-copy strong {
          font: 600 17px var(--font-serif);
        }
        .entry-copy small {
          color: var(--muted-foreground);
          font-size: 11px;
        }
        .arrow {
          font-size: 18px;
        }
        footer {
          display: flex;
          justify-content: space-between;
          gap: 20px;
          padding: 15px clamp(24px, 7vw, 88px);
          border-top: 1px solid var(--border);
          color: var(--muted-foreground);
          font: 600 9px var(--font-mono);
          letter-spacing: 0.08em;
        }
        @media (max-width: 700px) {
          .hero {
            min-height: 360px;
            background: var(--clinical-navy);
          }
          .section-heading,
          footer {
            align-items: start;
            flex-direction: column;
          }
          .entry {
            grid-template-columns: 34px minmax(0, 1fr) auto;
          }
        }
      </style>
    </template>
  };
}
