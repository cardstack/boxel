import type { TOC } from '@ember/component/template-only';

/**
 * Deep dive for the Beacons (Inbox) demo.
 */
const InboxNotes: TOC<object> = <template>
  <section class='dive' aria-label='How it works'>
    <header class='dive-head'>
      <p class='dive-kicker'>How it works</p>
      <h2>Points, not pairs</h2>
      <p class='dive-lede'>
        A beacon reports its position on the page. It does not participate in
        the animation — it never moves, scales, or changes shape. Other elements
        borrow that position as a starting or ending point for their own
        flights.
      </p>
    </header>

    <section class='dd'>
      <h3>Why not layoutId?</h3>
      <div class='dd-col'>
        <p>
          <code>layoutId</code>
          pairs two real elements and morphs one into the other. The engine
          measures both, then draws a single box that travels from the first to
          the second, crossfading their contents inside it.
        </p>
        <p>
          That is the wrong tool here. If the trash icon shared a
          <code>layoutId</code>
          with a deleted row, the icon would stretch into a 400-pixel-wide mail
          row on every delete. The bin is not becoming the row — the row is
          flying toward the bin.
        </p>
        <p>
          A beacon solves this. It sits in the toolbar, never moves, and reports
          its position when asked. The deleted row's flight uses that position
          as a destination, but the bin itself stays exactly where it is.
        </p>
      </div>

      <figure class='dd-fig'>
        <svg
          class='dg'
          viewBox='0 0 900 240'
          role='img'
          aria-label="Comparison: layoutId would morph the bin into the row's
            shape. A beacon just lends its position without changing."
        >
          <text class='dg-eb' x='20' y='22'>LAYOUTID — WRONG</text>
          <text class='dg-eb' x='480' y='22'>BEACON — RIGHT</text>

          <rect
            class='dg-plate'
            x='20'
            y='40'
            width='400'
            height='170'
            rx='10'
          />
          <rect class='dg-box' x='40' y='58' width='360' height='34' rx='5' />
          <text class='dg-t' x='220' y='80' text-anchor='middle'>mail row</text>
          <rect class='dg-hot' x='300' y='108' width='80' height='34' rx='5' />
          <text
            class='dg-t is-hot'
            x='340'
            y='130'
            text-anchor='middle'
          >bin</text>
          <path
            class='dg-hotline dg-dash'
            d='M220,92 C260,100 300,115 310,120'
          />
          <text class='dg-t is-faint' x='40' y='170'>the bin stretches into a
            row shape</text>
          <text class='dg-t is-faint' x='40' y='190'>that is not what this is</text>

          <rect
            class='dg-plate'
            x='480'
            y='40'
            width='400'
            height='170'
            rx='10'
          />
          <rect class='dg-box' x='500' y='58' width='320' height='34' rx='5' />
          <text class='dg-t' x='660' y='80' text-anchor='middle'>mail row</text>
          <circle class='dg-dot' cx='840' cy='124' r='8' />
          <text
            class='dg-t is-hot'
            x='826'
            y='150'
            text-anchor='middle'
          >bin</text>
          <path
            class='dg-hotline dg-dash'
            d='M660,92 C720,100 790,112 832,118'
          />
          <text class='dg-t is-faint' x='500' y='170'>the row flies toward a
            point</text>
          <text class='dg-t is-faint' x='500' y='190'>the bin stays exactly as
            it is</text>
        </svg>
        <figcaption>
          <code>layoutId</code>
          morphs shapes. A beacon lends a position. The bin never moves.
        </figcaption>
      </figure>
    </section>

    <section class='dd'>
      <h3>Compose works the same way, in reverse</h3>
      <div class='dd-col'>
        <p>
          A new row does not come from the Compose button — it mounts in the
          list as new data. But
          <code>@from=&#123;&#123;c.beacon "compose"&#125;&#125;</code>
          tells the animation to start from the button's position. The row pops
          out of the button and springs into its slot in the list. The button
          itself never animates.
        </p>
      </div>
    </section>

    <section class='dd'>
      <h3>The deleted row finishes its flight after leaving the list</h3>
      <div class='dd-col'>
        <p>
          Deleting a row removes it from the data array. Normally the element
          would unmount in the same frame. Here, the region keeps it alive as an
          orphan — a sprite that has left the DOM but still has a flight to
          complete.
        </p>
        <p>
          The orphan floats above the list on its way to the bin, fading as it
          goes. Meanwhile, the remaining rows close the gap on a quick spring.
          By the time the orphan reaches zero opacity, the list has already
          settled into its new shape.
        </p>
      </div>

      <figure class='dd-fig'>
        <svg
          class='dg'
          viewBox='0 0 900 220'
          role='img'
          aria-label='Three things happen simultaneously: the deleted row flies
            to the bin, the remaining rows close the gap, and the deleted row
            fades to zero.'
        >
          <text class='dg-eb' x='20' y='22'>THREE THINGS AT ONCE</text>

          <rect class='dg-box' x='60' y='50' width='240' height='38' rx='6' />
          <text class='dg-t' x='180' y='74' text-anchor='middle'>deleted row
            flies to bin</text>

          <rect class='dg-box' x='60' y='100' width='240' height='38' rx='6' />
          <text class='dg-t' x='180' y='124' text-anchor='middle'>remaining rows
            close the gap</text>

          <rect class='dg-box' x='60' y='150' width='240' height='38' rx='6' />
          <text class='dg-t' x='180' y='174' text-anchor='middle'>deleted row
            fades to zero</text>

          <rect
            class='dg-plate'
            x='400'
            y='50'
            width='460'
            height='138'
            rx='8'
          />
          <text class='dg-t is-dim' x='630' y='86' text-anchor='middle'>
            All on the same spring. The gap closes
          </text>
          <text class='dg-t is-dim' x='630' y='108' text-anchor='middle'>
            while the deleted row is still in the air.
          </text>
          <text class='dg-t is-dim' x='630' y='140' text-anchor='middle'>
            The list never waits for the exit to finish.
          </text>
          <text class='dg-t is-dim' x='630' y='162' text-anchor='middle'>
            It looks like one gesture, not three steps.
          </text>
        </svg>
        <figcaption>
          Compose in, delete out, gap closing — all simultaneous, all on
          springs.
        </figcaption>
      </figure>
    </section>
  </section>
</template>;

export default InboxNotes;
export { InboxNotes };
