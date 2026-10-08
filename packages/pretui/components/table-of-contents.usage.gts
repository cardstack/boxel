// Pretui — TableOfContents usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { TableOfContents } from './table-of-contents';
import type { TocItem } from './table-of-contents';
import { Token } from './token';

// ── TableOfContents ← docs-site scroll-spy TOCs ──────────────────────────
// The example needs a real scrolling document for the observer to spy on,
// so the page ships one: the sourcing manual, in its own scroll pane beside
// the TOC. The component auto-roots its IntersectionObserver on the nearest
// scrollable ancestor of the first heading, which is exactly that pane — no
// wiring from the caller.
const MANUAL: TocItem[] = [
  { id: 'sm-season', label: 'Before the season', level: 1 },
  { id: 'sm-booking', label: 'Booking a lot', level: 1 },
  { id: 'sm-deposit', label: 'Deposits', level: 2 },
  { id: 'sm-window', label: 'The pick window', level: 2 },
  { id: 'sm-cupping', label: 'Cupping', level: 1 },
  { id: 'sm-scoring', label: 'Scoring', level: 2 },
  { id: 'sm-customs', label: 'Shipping and customs', level: 1 },
  { id: 'sm-storage', label: 'Storage', level: 1 },
];

class TableOfContentsUsage extends Component {
  items = MANUAL;

  @tracked label = 'On this page';
  @tracked spy = true;
  @tracked band: number | null = 38;
  @tracked activeLabel = 'Before the season';

  setLabel = (v: string) => (this.label = v);
  setSpy = (v: boolean) => (this.spy = v);
  setBand = (v: number | null) => (this.band = v);
  onActiveChange = (id: string) => {
    this.activeLabel = MANUAL.find((i) => i.id === id)?.label ?? id;
  };

  get bandVal() {
    return this.band ?? undefined;
  }
  get usage() {
    let bits = ['@items={{this.items}}', `@label='${this.label}'`];
    if (!this.spy) bits.push('@spy={{false}}');
    if (this.band !== null && this.band !== 38) {
      bits.push(`@band={{${this.band}}}`);
    }
    bits.push('@onActiveChange={{this.onActiveChange}}');
    return `<TableOfContents\n  ${bits.join('\n  ')}\n/>`;
  }

  <template>
    <FreestyleUsage
      @name='TableOfContents'
      @description="Document navigation that knows where the reader is. It renders a nav landmark around an ordered list of anchors, marks the current section with aria-current='location', and moves a single travelling bar down the rail as you scroll — the marker is a sibling of the list carrying aria-hidden, so assistive tech reads eight links and no chrome. Section tracking is ONE IntersectionObserver created inside a modifier and disconnected on cleanup: no scroll handler, no re-measure per frame, no timer. It auto-roots on the nearest scrollable ancestor of the first heading, so a TOC beside a scrolling panel (like the manual on the right) works with no wiring. Scroll the manual to watch the marker travel; @band sets how far down the pane a heading must reach before it counts as current. Honest limits: no collapsible sub-lists (levels indent instead — an accordion in a TOC hides the thing the reader came for), and activation does not scroll for you; the anchor's href does whatever the caller's scroll-behavior says."
      @source={{this.usage}}
    >
      <:example>
        {{! the query container must be an ANCESTOR of the rule's subject —
            an unnamed @container can never match the container element
            itself, so .toc-layout gets a wrapper rather than the type }}
        <div class='toc-wrap'>
          <div class='toc-layout'>
            <TableOfContents
              class='toc-side'
              @items={{this.items}}
              @label={{this.label}}
              @spy={{this.spy}}
              @band={{this.bandVal}}
              @onActiveChange={{this.onActiveChange}}
            />
            <div class='toc-doc'>
              <section id='sm-season'>
                <h3 class='toc-h'>Before the season</h3>
                <p class='toc-p'>Every spring the desk re-reads last year's
                  scorecards before a single call is placed. Wuyi Origins and Uji
                  Valley Growers carry standing bookings; everyone else is quoted
                  fresh against the current sheet.</p>
                <p class='toc-p'>The manual exists because the same four mistakes
                  repeat: a deposit sent before the pick window is confirmed, a
                  cupping filed against the wrong lot id, a container booked
                  without the phytosanitary paperwork, and a crate stored above
                  the humidity ceiling.</p>
              </section>
              <section id='sm-booking'>
                <h3 class='toc-h'>Booking a lot</h3>
                <p class='toc-p'>A booking is a promise about a harvest that has
                  not happened yet. Name the estate, the cultivar, the target
                  weight and the pick window, and nothing else.</p>
              </section>
              <section id='sm-deposit'>
                <h4 class='toc-h toc-h-sub'>Deposits</h4>
                <p class='toc-p'>Thirty percent on signature, the balance against
                  the bill of lading. Never send a deposit against an unconfirmed
                  window — Fujian Maritime Tea will hold it, but Darjeeling First
                  Flush Ltd. will not.</p>
              </section>
              <section id='sm-window'>
                <h4 class='toc-h toc-h-sub'>The pick window</h4>
                <p class='toc-p'>Two weeks either side of the estate's own
                  estimate. Alishan Cloud Farms quotes narrow and hits it; Kericho
                  Leaf Union quotes wide and drifts late.</p>
              </section>
              <section id='sm-cupping'>
                <h3 class='toc-h'>Cupping</h3>
                <p class='toc-p'>Every arriving lot is cupped blind against the
                  sample that sold it. Three cups, one taster, notes filed the
                  same day against the lot id and nothing else.</p>
              </section>
              <section id='sm-scoring'>
                <h4 class='toc-h toc-h-sub'>Scoring</h4>
                <p class='toc-p'>A hundred-point sheet, but only the band matters:
                  above ninety it goes to the ceremonial menu, eighty to ninety to
                  the house blend, below eighty back to the supplier with the
                  cups photographed.</p>
              </section>
              <section id='sm-customs'>
                <h3 class='toc-h'>Shipping and customs</h3>
                <p class='toc-p'>Sea freight from Fuzhou, air only for first
                  flush. The paperwork travels ahead of the container, never with
                  it, and the customs broker gets the cupping certificate before
                  the vessel sails.</p>
              </section>
              <section id='sm-storage'>
                <h3 class='toc-h'>Storage</h3>
                <p class='toc-p'>Sixty percent relative humidity, no light, no
                  neighbours with a smell. Pu-erh is the exception and lives in
                  its own room, which is the only reason the humidity logs are
                  audited monthly.</p>
                <p class='toc-p'>Anything that fails an audit is re-cupped before
                  it is re-priced, not after.</p>
              </section>
            </div>
          </div>
        </div>
        <p class='sd-readout'>
          Current section:
          <Token @value={{this.activeLabel}} />
        </p>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='items'
          @required={{true}}
          @value={{this.items}}
          @description='Sections in document order. Each TocItem is { id, label, level? } where id is the target element’s DOM id — it becomes the link’s href fragment and the observer’s target.'
        />
        <Args.String
          @name='label'
          @value={{this.label}}
          @defaultValue='On this page'
          @description='Accessible name for the nav landmark.'
          @onInput={{this.setLabel}}
        />
        <Args.Bool
          @name='spy'
          @value={{this.spy}}
          @defaultValue={{true}}
          @description='Watch the document and follow the reader’s scroll. Defaults to @links: on for fragment links, off for buttons, whose ids need not be DOM ids. Turn it off to drive the active section entirely from @activeId.'
          @onInput={{this.setSpy}}
        />
        <Args.Number
          @name='band'
          @value={{this.band}}
          @min={{5}}
          @max={{90}}
          @step={{1}}
          @defaultValue={{38}}
          @description='How far down the scroll pane, as a percentage, a heading must reach before it becomes current. Low values make the TOC eager; high values make it lag behind the reader.'
          @onInput={{this.setBand}}
        />
        <Args.String
          @name='activeId'
          @description='Controlled active id. Pass it and the component stops owning the active state — the observer still reports through @onActiveChange.'
          @hideControls={{true}}
        />
        <Args.String
          @name='defaultActiveId'
          @description='Initial active id when uncontrolled. Defaults to the first item.'
          @hideControls={{true}}
        />
        <Args.Action
          @name='onActiveChange'
          @description='Fires with the id whenever the active section changes, from a click or from the observer.'
          @hideControls={{true}}
        />
        <Args.Bool
          @name='links'
          @defaultValue={{true}}
          @description='Rows are fragment links (a href="#id"). False renders them as button type=button with no href, and the component does no scrolling: a caller whose sections sit in its own scroll panel scrolls from the @onSelect event’s currentTarget. @spy then defaults off.'
          @hideControls={{true}}
        />
        <Args.Action
          @name='onSelect'
          @description='Fires with (id, event) when a row is clicked, in either mode. It only reports: passing it never changes what renders, so link-mode rows keep their hrefs.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name=':item'
          @description='Replaces the row text. Receives (item, active, index) so a caller can render a count, an icon, a progress dot, or a step number beside the label.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .toc-wrap {
        container-type: inline-size;
        min-width: 0;
      }
      .toc-layout {
        display: grid;
        grid-template-columns: 13rem 1fr;
        gap: var(--boxel-sp);
        align-items: start;
        min-width: 0;
      }
      .toc-side {
        position: sticky;
        top: 0;
      }
      .toc-doc {
        max-height: 19rem;
        overflow-y: auto;
        padding: var(--boxel-sp-sm) var(--boxel-sp);
        border-radius: var(--boxel-border-radius);
        background-color: var(--card);
        color: var(--card-foreground);
        box-shadow: 0 0 0 1px var(--border);
        min-width: 0;
      }
      .toc-h {
        margin: var(--boxel-sp) 0 var(--boxel-sp-3xs);
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
      }
      .toc-h-sub {
        font-size: var(--boxel-font-size-xs);
        color: var(--muted-foreground);
      }
      .toc-doc section:first-child .toc-h {
        margin-top: 0;
      }
      .toc-p {
        margin: 0 0 var(--boxel-sp-2xs);
        font-size: var(--boxel-font-size-xs);
        line-height: 1.55;
        color: var(--muted-foreground);
        max-width: 56ch;
      }
      .sd-readout {
        margin: var(--boxel-sp-xs) 0 0;
        font-size: var(--boxel-font-size-2xs);
        color: var(--muted-foreground);
      }
      /* unnamed container query only — the named forms silently delete every
         following rule in the transpiled stylesheet */
      @container (max-width: 34rem) {
        .toc-layout {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </template>
}

export const DEMOS_TABLE_OF_CONTENTS: Record<string, unknown> = {
  TableOfContents: TableOfContentsUsage,
};
