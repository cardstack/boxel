import type { TOC } from '@ember/component/template-only';

/**
 * Deep dive for the Curves (layout-toggle) demo.
 */
const LayoutNotes: TOC<object> = <template>
  <section class='dive' aria-label='How it works'>
    <header class='dive-head'>
      <p class='dive-kicker'>How it works</p>
      <h2>Measure, then undo the jump</h2>
      <p class='dive-lede'>
        Nothing here is positioned by hand. The browser lays out a list, then a
        grid. The engine measures both layouts and animates the difference.
      </p>
    </header>

    <section class='dd'>
      <h3>How layout=true works</h3>
      <div class='dd-col'>
        <p>
          <strong>1. Measure before.</strong>
          The engine records the position and size of every element marked with
          <code>layout=true</code>.
        </p>
        <p>
          <strong>2. Let the change happen.</strong>
          The class flips from list to grid (or back). The browser recalculates
          the layout, and every element jumps to its new position in a single
          frame.
        </p>
        <p>
          <strong>3. Undo the jump, then let go.</strong>
          The engine applies a transform that puts each element back where it
          was before the change. From the user's perspective, nothing moved.
          Then it animates that transform down to zero. The element glides
          smoothly from its old position to its new one.
        </p>
      </div>

      <figure class='dd-fig'>
        <svg
          class='dg'
          viewBox='0 0 900 320'
          role='img'
          aria-label='Three stages: the list layout is measured, the layout
            changes to a grid, then an inverse transform animates to zero.'
        >
          <text class='dg-eb' x='20' y='22'>BEFORE</text>
          <text class='dg-eb' x='320' y='22'>LAYOUT CHANGES</text>
          <text class='dg-eb' x='620' y='22'>ANIMATE</text>

          <rect
            class='dg-plate'
            x='20'
            y='40'
            width='260'
            height='240'
            rx='8'
          />
          <rect class='dg-box' x='40' y='60' width='220' height='44' rx='5' />
          <rect class='dg-hot' x='40' y='114' width='220' height='44' rx='5' />
          <rect class='dg-box' x='40' y='168' width='220' height='44' rx='5' />
          <rect class='dg-box' x='40' y='222' width='220' height='44' rx='5' />
          <text
            class='dg-t is-faint'
            x='150'
            y='296'
            text-anchor='middle'
          >list</text>

          <rect
            class='dg-plate'
            x='320'
            y='40'
            width='260'
            height='240'
            rx='8'
          />
          <rect class='dg-box' x='340' y='60' width='110' height='100' rx='5' />
          <rect class='dg-hot' x='460' y='60' width='100' height='100' rx='5' />
          <rect
            class='dg-box'
            x='340'
            y='170'
            width='110'
            height='100'
            rx='5'
          />
          <rect
            class='dg-box'
            x='460'
            y='170'
            width='100'
            height='100'
            rx='5'
          />
          <text
            class='dg-t is-faint'
            x='450'
            y='296'
            text-anchor='middle'
          >grid</text>

          <rect
            class='dg-plate'
            x='620'
            y='40'
            width='260'
            height='240'
            rx='8'
          />
          <rect class='dg-box' x='640' y='60' width='110' height='100' rx='5' />
          <rect
            class='dg-box'
            x='640'
            y='170'
            width='110'
            height='100'
            rx='5'
          />
          <rect
            class='dg-box'
            x='760'
            y='170'
            width='100'
            height='100'
            rx='5'
          />

          <rect class='dg-hot' x='660' y='90' width='80' height='60' rx='5' />
          <path class='dg-hotline dg-dash' d='M700,150 L760,60' />
          <circle class='dg-copdot' cx='760' cy='60' r='3' />
          <text class='dg-t is-cop' x='780' y='60'>target</text>
          <text
            class='dg-t is-hot'
            x='700'
            y='170'
            text-anchor='middle'
          >mid-flight</text>
          <text
            class='dg-t is-faint'
            x='750'
            y='296'
            text-anchor='middle'
          >animating</text>
        </svg>
        <figcaption>
          The layout has already changed. The animation is the element
          pretending to still be in its old position, then letting go.
        </figcaption>
      </figure>
    </section>

    <section class='dd'>
      <h3>layout="position" keeps text sharp</h3>
      <div class='dd-col'>
        <p>
          A card going from a tall list row to a wide grid tile is scaled on
          both axes. That scale is not uniform — the width grows more than the
          height — and everything inside inherits the distortion. Text under a
          non-uniform scale looks smeared.
        </p>
        <p>
          <code>layout="position"</code>
          tells the engine to move this child to its new position but not apply
          the parent's scale to it. The child is measured at its actual size,
          and only its position is animated. The parent can squash and stretch;
          the text inside stays crisp.
        </p>
      </div>

      <figure class='dd-fig'>
        <svg
          class='dg'
          viewBox='0 0 900 200'
          role='img'
          aria-label='Comparison: layout=true stretches the text with the
            parent, layout=position keeps the text at its real size.'
        >
          <text class='dg-eb' x='20' y='22'>LAYOUT=TRUE (ALL)</text>
          <text class='dg-eb' x='480' y='22'>LAYOUT=POSITION</text>

          <rect
            class='dg-plate'
            x='20'
            y='44'
            width='400'
            height='130'
            rx='8'
          />
          <rect class='dg-box' x='40' y='60' width='360' height='48' rx='5' />
          <text
            class='dg-t'
            x='220'
            y='90'
            text-anchor='middle'
            transform='scale(1.6, 0.7)'
            transform-origin='220 90'
          >Atlas</text>
          <text class='dg-t is-faint' x='220' y='148' text-anchor='middle'>text
            is stretched with the card</text>

          <rect
            class='dg-plate'
            x='480'
            y='44'
            width='400'
            height='130'
            rx='8'
          />
          <rect class='dg-box' x='500' y='60' width='360' height='48' rx='5' />
          <text
            class='dg-t is-hot'
            x='680'
            y='90'
            text-anchor='middle'
          >Atlas</text>
          <text class='dg-t is-faint' x='680' y='148' text-anchor='middle'>text
            stays at its real size</text>
        </svg>
        <figcaption>
          Same animation, different child mode. The text on the right is always
          rendered at its actual font size.
        </figcaption>
      </figure>
    </section>

    <section class='dd'>
      <h3>The curve is the variable</h3>
      <div class='dd-col'>
        <p>
          The four buttons at the top — snap, bounce, ease, linear — all trigger
          the same layout change. The only thing that differs is the transition
          spec passed to each element.
        </p>
        <p>
          A spring with zero bounce arrives instantly. A bouncy spring
          overshoots and settles. A CSS-style ease settles smoothly. Linear
          moves at a constant rate. The mechanism is the same for all four; the
          feel is the variable. This demo exists to compare them side by side.
        </p>
      </div>
    </section>
  </section>
</template>;

export default LayoutNotes;
export { LayoutNotes };
