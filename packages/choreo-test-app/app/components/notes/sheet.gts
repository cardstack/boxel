import type { TOC } from '@ember/component/template-only';
import { CodeBox } from 'test-app/components/code-box';

const LAND = `land = (event, info) => {
  const released = this.startedAt + info.offset.y;
  const projected = released + info.velocity.y * 0.16;
  this.mode = nearest(projected);
};`;

const LAYOUT = `<div class="share-tiles">
  {{#each targets as |t|}}
    <button class="share-tile is-{{t.id}}" {{motion layout=true}}>
      <span class="share-mark" {{motion layout="position"}}> … </span>
      <span class="share-copy" {{motion layout="position"}}> … </span>
    </button>
  {{/each}}
</div>`;

/**
 * Deep dive for the Sheet demo.
 */
const SheetNotes: TOC<object> = <template>
  <section class="dive" aria-label="How it works">
    <header class="dive-head">
      <p class="dive-kicker">How it works</p>
      <h2>The finger lets go, the spring takes over</h2>
      <p class="dive-lede">
        While you drag, the sheet is exactly where your finger put it. When you
        release, a spring carries it to the nearest detent. Same element, same
        value, no jump.
      </p>
    </header>

    <section class="dd">
      <h3>Drag owns the value, then hands it back</h3>
      <div class="dd-col">
        <p>
          <code>drag="y"</code>
          takes ownership of the element's vertical position. While the finger
          is down, the element tracks the pointer directly — no spring, no
          delay.
        </p>
        <p>
          When the finger lifts, the drag gesture releases ownership. The
          element is at whatever
          <em>y</em>
          the pointer left it at. Now
          <code>animate</code>
          takes over: it is bound to the resting position of a detent, and the
          spring starts from the release point with the finger's velocity
          already baked in.
        </p>
        <p>
          There is no remount, no state machine, and no jump at the handoff. One
          element, one motion value, two owners that swap cleanly.
        </p>
      </div>

      <figure class="dd-fig">
        <svg
          class="dg"
          viewBox="0 0 900 200"
          role="img"
          aria-label="Timeline showing drag owning y during the gesture,
            then the spring taking over at the release point, with velocity
            transferring at the handoff."
        >
          <text class="dg-eb" x="20" y="22">WHO OWNS Y</text>

          <line class="dg-rule" x1="100" y1="160" x2="850" y2="160" />

          <rect class="dg-box" x="100" y="54" width="320" height="40" rx="6" />
          <text class="dg-t" x="260" y="78" text-anchor="middle">drag — tracks
            the finger</text>

          <rect class="dg-hot" x="440" y="54" width="410" height="40" rx="6" />
          <text class="dg-t is-hot" x="645" y="78" text-anchor="middle">spring —
            carries to the detent</text>

          <line class="dg-cop dg-dash" x1="420" y1="44" x2="420" y2="160" />
          <circle class="dg-dot" cx="420" cy="74" r="4.5" />
          <text class="dg-t is-cop" x="426" y="120">release</text>
          <text class="dg-t is-faint" x="426" y="140">velocity transfers here</text>
        </svg>
        <figcaption>
          The handoff is one frame. Drag stops, spring starts, the speed carries
          across.
        </figcaption>
      </figure>
    </section>

    <section class="dd">
      <h3>The detent is picked from where the throw was going</h3>
      <div class="dd-col">
        <p>
          Which detent wins is not the one nearest where the finger stopped. It
          is the one nearest where the throw was
          <em>going</em>.
        </p>
        <p>
          <code>onDragEnd</code>
          provides the velocity at release. The code projects 160ms of that
          velocity past the release point, then picks the nearest detent from
          that projected position. A fast flick past a nearby detent reaches one
          further away. A slow release lands on the closest one.
        </p>
      </div>
      <CodeBox @label="sheet.gts" @source={{LAND}} />

      <figure class="dd-fig">
        <svg
          class="dg"
          viewBox="0 0 900 260"
          role="img"
          aria-label="The finger releases between two detents. A slow release
            picks the near one; a fast flick projects past it to the far one."
        >
          <text class="dg-eb" x="20" y="22">PROJECTED DESTINATION</text>

          <line class="dg-rule" x1="80" y1="60" x2="80" y2="240" />
          <line class="dg-hair dg-dash" x1="80" y1="80" x2="860" y2="80" />
          <line class="dg-hair dg-dash" x1="80" y1="160" x2="860" y2="160" />
          <line class="dg-hair dg-dash" x1="80" y1="230" x2="860" y2="230" />
          <text class="dg-t is-faint" x="70" y="84" text-anchor="end">app</text>
          <text
            class="dg-t is-faint"
            x="70"
            y="164"
            text-anchor="end"
          >rows</text>
          <text
            class="dg-t is-faint"
            x="70"
            y="234"
            text-anchor="end"
          >icons</text>

          <circle class="dg-dot" cx="250" cy="130" r="5" />
          <text class="dg-t" x="260" y="128">finger releases here</text>

          <path class="dg-inkline dg-dash" d="M250,130 L350,150" />
          <circle class="dg-faintdot" cx="350" cy="150" r="4" />
          <text class="dg-t is-dim" x="360" y="148">slow → projects to rows</text>

          <path class="dg-hotline dg-dash" d="M250,130 L500,80" />
          <circle class="dg-copdot" cx="500" cy="80" r="4" />
          <text class="dg-t is-hot" x="510" y="78">fast → projects to app</text>
        </svg>
        <figcaption>
          Same release point, different speeds, different detents. The
          projection is what makes a flick feel like a flick.
        </figcaption>
      </figure>
    </section>

    <section class="dd">
      <h3>Four buttons, four modes, one set of elements</h3>
      <div class="dd-col">
        <p>
          The share tiles — AirDrop, Message, Mail, Copy link — are the same
          four elements in every mode. Nothing is mounted or unmounted when the
          mode changes. A class swap changes the CSS layout (stacked deck, icon
          row, menu lines, full rows), and
          <code>layout=true</code>
          animates the resulting position and size change.
        </p>
      </div>
      <CodeBox @label="sheet.gts" @source={{LAYOUT}} />
      <div class="dd-col">
        <p>
          <code>layout="position"</code>
          on the icon and the label keeps them sharp. The tile changes shape
          between modes, and position-only children are measured independently
          instead of being stretched with their parent.
        </p>
      </div>
    </section>
  </section>
</template>;

export default SheetNotes;
export { SheetNotes };
