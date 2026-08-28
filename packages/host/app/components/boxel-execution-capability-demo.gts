import Component from '@glimmer/component';

import { rri, type LooseSingleCardDocument } from '@cardstack/runtime-common';

import BoxelDocumentRenderer from '@cardstack/host/components/boxel-document-renderer';

const CARD_MODULE = rri('@cardstack/base/execution-capability-probe');
const CARD_ID = 'https://cardstack.com/host-internal/capability-probe/demo';

export default class BoxelExecutionCapabilityDemo extends Component {
  private readonly document: LooseSingleCardDocument = {
    data: {
      id: CARD_ID,
      attributes: {},
      meta: {
        adoptsFrom: {
          module: CARD_MODULE,
          name: 'ExecutionCapabilityProbe',
        },
      },
    },
  };

  <template>
    <main class='capability-page'>
      <article class='comparison-card'>
        <header class='comparison-header'>
          <div>
            <p class='eyebrow'>DELEGATED EXECUTION · SAME CARD · TWO MODES</p>
            <h1>Direct succeeds. Sandbox contains it.</h1>
            <p class='lede'>
              Both columns render the same trusted Base card through the
              document-first Render Protocol. The Host explicitly routes one
              document to Direct and strengthens its identical twin to the
              isolated Sandbox.
            </p>
          </div>
          <div class='verdict' aria-label='Expected security verdict'>
            <span class='verdict-direct'>Direct · 20 succeed</span>
            <span class='verdict-sandbox'>Sandbox · 20 denied</span>
          </div>
        </header>

        <aside class='safety-note'>
          The hostile scenarios use synthetic canaries and reversible DOM
          changes. No real realm is modified, no real secret is read, and no
          outbound beacon is sent.
        </aside>

        <div class='delegated-pair'>
          <section class='delegated-column direct-column'>
            <div class='route-label'>
              <strong>Host routing decision</strong>
              <code>execution: direct</code>
            </div>
            <BoxelDocumentRenderer
              @document={{this.document}}
              @relativeTo={{CARD_ID}}
              @format='isolated'
              @execution='direct'
            />
          </section>

          <section class='delegated-column sandbox-column'>
            <div class='route-label'>
              <strong>Host routing decision</strong>
              <code>execution: sandbox</code>
            </div>
            <BoxelDocumentRenderer
              @document={{this.document}}
              @relativeTo={{CARD_ID}}
              @format='isolated'
              @execution='sandbox'
            />
          </section>
        </div>

        <footer class='comparison-footer'>
          Direct is a Host capability. Authored code cannot select it. The
          Sandbox twin receives the same document and card module, but no
          ambient authority over the Host page.
        </footer>
      </article>
    </main>

    <style scoped>
      .capability-page {
        box-sizing: border-box;
        min-height: 100vh;
        overflow: auto;
        padding: 2rem;
        background: #eeece5;
        color: #171714;
        font-family: var(--boxel-font-family, sans-serif);
      }

      .comparison-card {
        max-width: 112rem;
        margin: 0 auto;
        overflow: hidden;
        border: 1px solid #c9c4b5;
        border-radius: 1.25rem;
        background: #fff;
        box-shadow: 0 1.5rem 4rem rgb(35 31 22 / 12%);
      }

      .comparison-header {
        display: flex;
        justify-content: space-between;
        gap: 2rem;
        padding: 2rem;
        border-bottom: 1px solid #d8d3c5;
        background: #fff;
      }

      .eyebrow {
        margin: 0 0 0.75rem;
        color: #5e594d;
        font-family: monospace;
        font-size: 0.75rem;
        font-weight: 800;
        letter-spacing: 0.12em;
      }

      h1,
      p {
        margin: 0;
      }

      h1 {
        font-size: clamp(2rem, 4vw, 4rem);
        letter-spacing: -0.05em;
        line-height: 0.95;
      }

      .lede {
        max-width: 58rem;
        margin-top: 1rem;
        color: #5b574d;
        font-size: 1rem;
        line-height: 1.55;
      }

      .verdict {
        display: flex;
        flex: 0 0 auto;
        flex-direction: column;
        align-items: flex-end;
        gap: 0.5rem;
        font-family: monospace;
        font-size: 0.75rem;
        font-weight: 800;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }

      .verdict-direct {
        color: #08784d;
      }

      .verdict-sandbox {
        color: #9a351a;
      }

      .safety-note {
        padding: 0.85rem 2rem;
        border-bottom: 1px solid #dfd4a2;
        background: #fff6c8;
        color: #5f4700;
        font-size: 0.85rem;
        line-height: 1.45;
      }

      .delegated-pair {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1rem;
        padding: 1rem;
        background: #e5e2d9;
      }

      .delegated-column {
        min-width: 0;
      }

      .route-label {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        margin-bottom: 0.5rem;
        padding: 0.65rem 0.85rem;
        border-radius: 0.65rem;
        background: #171714;
        color: #fff;
        font-size: 0.7rem;
      }

      .sandbox-column .route-label {
        background: #542719;
      }

      .route-label strong {
        text-transform: uppercase;
      }

      .route-label code {
        color: #78eabe;
        font-family: monospace;
      }

      .sandbox-column .route-label code {
        color: #ffb39a;
      }

      .comparison-footer {
        padding: 1.25rem 2rem;
        background: #171714;
        color: #d8d4c8;
        font-size: 0.875rem;
        line-height: 1.5;
      }

      @media (max-width: 70rem) {
        .comparison-header {
          flex-direction: column;
        }

        .verdict {
          align-items: flex-start;
        }

        .delegated-pair {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 42rem) {
        .capability-page {
          padding: 0.75rem;
        }

        .comparison-header {
          padding: 1.25rem;
        }

        .safety-note {
          padding-inline: 1.25rem;
        }
      }
    </style>
  </template>
}
