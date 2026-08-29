import type { TOC } from '@ember/component/template-only';

/**
 * Deep dive for the In place demo — and the long-form version of everything
 * this session cost to learn.
 */
const InlineEditNotes: TOC<object> = <template>
  <section class="dive" aria-label="How it works">
    <header class="dive-head">
      <p class="dive-kicker">How it works</p>
      <h2>A composed view and a generated form are not the same kind of layout</h2>
      <p class="dive-lede">
        Animating between a record's reading view and its edit form looks like
        one problem and is three. The two poses answer to different authorities
        — one is composed for this record, the other is generated from a field
        list. The type has to leave layout to travel at all. And the flight
        itself is hostile to every convenience CSS gives you for positioning a
        box, because a move takes away the one thing those conveniences are
        computed against.
      </p>
    </header>

    <section class="dd">
      <h3>The two poses are different kinds of thing</h3>
      <div class="dd-col">
        <p>
          The reading view is a COMPOSITION. Somebody decided that this record
          deserves a large name, a job title under it in a second voice, and the
          contact details as a quiet footer with the email and the date on one
          line. It is a piece of design about a person, and its rules are local:
          they hold for this card and nothing else.
        </p>
        <p>
          The form is GENERATED. It has one type scale, because a form is a
          place where every value is the same kind of thing; a label above each
          field, because a control with no name is a puzzle; and a uniform
          chrome, because the design system says what a field looks like. Its
          rules come from the system, and the only thing this card contributes
          is which fields exist and in what order.
        </p>
        <p>
          That asymmetry is the whole design problem. It is tempting to make the
          reading view a de-styled form — same rows, same order, smaller type —
          because then the transition is trivial. It is also why most in-place
          editors feel like a form that got its labels turned off. If the
          reading view is worth composing at all, the transition has to survive
          the composition.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>The form's order is the only order</h3>
      <div class="dd-col">
        <p>
          The generated side is the one with a canonical order, so everything
          else derives from it. Here that is a single
          <code>FIELDS</code>
          array; the lanes, the grid's row template, the card's height and the
          flight plan are all consequences of it.
        </p>
        <p>
          This started as three copies of the same list — the field array, a
          hand-written lane order beside it, and
          <code>grid-template-areas</code>
          in the stylesheet. Adding a job title put them out of step: the new
          lane had a name no row template knew, so it dropped into an implicit
          row at the bottom and the form read name, email, date of birth, job
          title. Nothing errored. The stylesheet is handed its row template now,
          because a stylesheet that restates the field order is a second copy of
          it, and copies drift.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>Two layers, two laws</h3>
      <div class="dd-col">
        <p>
          Split the card in two and give each half a different rule.
        </p>
        <p>
          The BACKGROUND is boxes with borders, and it is a containment
          hierarchy: one white card holding one platter per field, each in its
          own lane. The lanes are in the same order in both poses and a platter
          never leaves its own, so no box can cross another — they grow, shrink
          and slide along their lane. Everything a field IS lives inside its
          platter, so the outline cannot escape the platter's bounds for the
          simple reason that it is the platter's own border.
        </p>
        <p>
          The FOREGROUND is type, and it is a layer OVER the card rather than
          content inside the platters. Nothing lays it out and nothing clips it,
          so it is free to cross — which is how the reading view puts the email
          and the date on one line while their platters sit in two separate
          lanes underneath. The words fly diagonally over a boundary the boxes
          never touch.
        </p>
        <p>
          The split is what lets the composed view keep its composition. Boxes
          that never cross give you a background that cannot tangle; type that
          may cross gives you a foreground that can be arranged freely. Trying
          to get both out of one layer is what forces the reading view to become
          a de-styled form.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>Constraint layout and the flight are enemies</h3>
      <div class="dd-col">
        <p>
          This is the deepest lesson here, and it cost the most. A FLIP move
          holds an element still by writing a transform computed against where
          the layout puts it — and while it plays, it also OVERRIDES the
          element's width and height.
        </p>
        <p>
          So any box whose position is computed FROM ITS OWN SIZE, or from a
          sibling's, moves out from under its own transform the instant the move
          starts. Three different disguises of that bug appeared here:
        </p>
        <p>
          <b>Alignment.</b>
          A platter held to the bottom of its lane with
          <code>align-self: end</code>
          arrived eighteen pixels high and animated the remainder, because the
          overridden height re-resolved the alignment.
        </p>
        <p>
          <b>A flex sibling.</b>
          The avatar shrinking under its own move narrowed the flex row, which
          moved the eyebrow beside it — so the eyebrow was offset by the same
          thirty-eight pixels twice and overlapped the avatar by twenty-seven
          for the first frames of every pass back.
        </p>
        <p>
          <b>A percentage translate.</b>
          <code>top: 50%</code>
          with
          <code>translate: 0 -50%</code>
          resolves the translate against the element's own height, so the avatar
          slid by half the change in its height and took the initials with it.
          Nineteen pixels, every pass, both directions.
        </p>
        <p>
          The rule that falls out:
          <b>anything a move touches must be positioned by an edge, from a
            number.</b>
          Not centred, not aligned, not spaced by a sibling. Those are exactly
          the conveniences a constraint-based layout is for, and they are all
          computed against a size the move is in the middle of taking away.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>Two more ways a container betrays a flight</h3>
      <div class="dd-col">
        <p>
          <code>fr</code>
          tracks are floored at the AUTO minimum of their items. A platter
          mid-flight carries an inline width from the move it is playing, so two
          147px columns became two 302px columns, the card's grid was suddenly
          twice the card, and every lane started in the wrong place.
          <code>minmax(0, 1fr)</code>
          everywhere a moved element lives.
        </p>
        <p>
          An AUTO column is sized by what its items ask for. Mid-flight the card
          asked for more than it was given, the column grew, and the centred
          card was centred in something wider than the stage — the whole card
          lurched seventy pixels sideways and slid back. Give the stage an
          explicit column and let the contents overflow it.
        </p>
        <p>
          Both have the same shape as the three above: a layout that computes a
          position from a size, and a move that changes the size.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>The moment of the switch is the footgun</h3>
      <div class="dd-col">
        <p>
          A crossing measures the world before a render and again after it.
          Anything that changes layout OUTSIDE that render has already moved the
          "before", and the changeset comes back with nothing to animate.
        </p>
        <p>
          Here the card's row heights were inline custom properties on the
          wrapper — outside the region. The mode change resized the card before
          the region took its before-picture, every platter measured the same
          box twice, and they snapped to their new lane while the type flew
          across on its own. Nothing errored; every other step still ran. That
          is the signature of this bug, and it is worth recognising:
          <b>one thing snaps while everything else animates.</b>
        </p>
        <p>
          Two rules. The flag that says which pose you are in must live on an
          element INSIDE the region — the card's own
          <code>[data-mode]</code>, not an ancestor's class. And anything
          derived from that flag and handed to CSS must be mode-INDEPENDENT:
          publish both poses' numbers, and let the mode attribute choose.
        </p>
        <p>
          The same trap has a tracked-state version. Reading a tracked "a
          crossing is under way" flag in the template re-renders the component,
          and a render inside a region is itself a pass — so standing the flag
          down at the end of a flight kicked off a second one. The arming is
          read as a promise instead, and the attribute is written by hand.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>A region is not a participant, and neither is a child by default</h3>
      <div class="dd-col">
        <p>
          The white card was the
          <code>&lt;Choreo&gt;</code>
          element for a long time, and it snapped between its two heights while
          everything inside it flew. A region is the frame a crossing is
          measured IN; it is not one of the things measured, so it has no before
          and after of its own. The card is a participant now with a
          <code>c.Move</code>
          like any other box, and the region is a bare stage.
        </p>
        <p>
          The mirror of that: a nested participant is PROJECTED against its
          parent rather than carried by it. The initials inside the avatar had
          no move of their own, so they sat at the avatar's destination while
          the avatar was still travelling. If a descendant is a participant at
          all, it needs its own step.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>Keyframe arrays, and why every step here is a function</h3>
      <div class="dd-col">
        <p>
          Rest poses belong in CSS. But that means the new value is already on
          the element by the time the region measures the pass, so a step given
          a single target finds the element already there and animates nothing.
          Both ends have to be stated —
          <code>['30px', '17px']</code>
          — which is a keyframe array.
        </p>
        <p>
          The cost is that a keyframe array is NOT idempotent. Any later pass
          replays it from a pose the card has already left, and a later pass is
          not hypothetical: one arrives as the run settles. The plates and the
          avatar's corners were visibly animating back out of the form after the
          card had finished becoming a card.
        </p>
        <p>
          So every step property is a function rather than a value. A step
          property may be a function of the sprite it is applied to, and it is
          evaluated per pass — which means it can answer with both ends for the
          pass that IS the mode change, and with the single current value for
          every other pass the region will ever run. The flag it consults is a
          plain field, never tracked, for the reason above.
        </p>
        <p>
          The same mechanism does something better, too: one step carries every
          word on the card, because the function can answer differently for each
          sprite. Four fields at three type scales, out of one
          <code>c.Tween</code>.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>Type: why it has to leave layout</h3>
      <div class="dd-col">
        <p>
          <code>font-size</code>
          is a LAYOUT property, and every arrangement that lets the browser flow
          the words collides with that. A copy per pose means the arriving one
          re-lays-out as it grows, so the crossing pins against a box that is
          still moving and you see the name twice, sliding past itself. One
          flowed copy collapses its own box. And in both, the gaps inside a
          multi-word line go wrong in flight — "14 March 1986" arriving as
          "14&nbsp;&nbsp;March1986" — because each word is travelling alone and
          nothing is interpolating the LINE. The space between two words is a
          property of neither of them.
        </p>
        <p>
          So the words leave flow entirely. pretext measures text with the
          browser's own font engine through canvas and lays it out as pure
          arithmetic: no DOM, no reflow, and no requirement that the pose being
          measured is the one on screen. Both ends of every word's journey are
          computed up front, the words are positioned absolutely, and the score
          tweens x, y, size, weight, kerning and colour.
        </p>
        <p>
          That last requirement is the one that generalises. A record's reading
          view and its editor are not usually one component by one author — they
          are two, and only one is ever rendered, so neither can measure the
          other by asking the DOM. Measuring the pose you are not showing is the
          whole reason this approach exists.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>Making measured text and rendered text agree</h3>
      <div class="dd-col">
        <p>
          A word only lands invisibly if the flight and the real text are the
          SAME text. Four things had to be reconciled, and each was worth a bug:
        </p>
        <p>
          <b>The inter-word gap is not yours to invent.</b>
          A flat
          <code>0.3em</code>
          between words put the first word on the pixel and every word after it
          a few out. A space's advance is the font's business, it varies with
          the face and with letter-spacing, and it is already inside a
          measurement of the line. Each word's left edge is the whole line's
          width less the width of the line from that word on.
        </p>
        <p>
          <b>The width axis must be said in the shorthand.</b>
          <code>font-variation-settings: 'wdth' 88</code>
          renders the face you want but cannot appear in the canvas font
          shorthand pretext measures with — so pretext measures the wide cut
          while the screen draws the narrow one. About thirty pixels of error on
          a two-word name, all of it in the gaps.
          <code>font-stretch</code>
          reaches the same axis and IS in the shorthand.
        </p>
        <p>
          <b>Tracking is per-pose, not shared.</b>
          The reading view sets the name at
          <code>-0.03em</code>
          and everything else at
          <code>-0.01em</code>, and the layout was computed against exactly
          those. A flight word wearing the shared value laid its glyphs to a
          tracking the plan had not used: first letter on the pixel, every
          letter after it drifting.
        </p>
        <p>
          <b>The line box has to match.</b>
          Centring a
          <code>line-height: 1.18</code>
          box is not centring a 40px one — where a glyph sits inside a line box
          comes from the font's metrics, not the box's centre — so the flight
          rode a pixel high and the handover was a small vertical jump. One line
          box, declared once, shared by the flight, the reading string and the
          controls.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>A variable font, and a hypothesis that did not survive</h3>
      <div class="dd-col">
        <p>
          A variable font is what makes a weight change animatable at all: with
          static cuts the browser can only swap files, and the weight pops at
          whatever frame the swap lands on. Registering
          <code>fontWeight</code>
          as unitless in the library is what lets it interpolate as a number.
        </p>
        <p>
          It is also expensive, at least in theory. Every distinct weight is a
          fresh glyph raster, and engines differ in how they cache that — so
          when this demo turned out to be markedly slower in Safari than in
          Chrome, the weight tween was the obvious suspect. A dozen words each
          interpolating weight for half a second is a dozen text runs
          re-rendered sixty times a second.
        </p>
        <p>
          <b>It was not the cause.</b>
          Disabling the weight tween in Safari — snapping it, and crossfading
          two constant-weight copies so the change still read — made no
          measurable difference, and the branch was removed rather than kept on
          the strength of a plausible story. It cost a user-agent sniff, a
          doubled DOM and two extra steps, for nothing.
        </p>
        <p>
          Which leaves the real cause unfound, and the remaining suspects worth
          writing down for whoever looks next. A rounded
          <code>overflow: hidden</code>
          clip on four platters that resize every frame is a known WebKit
          hotspot. So is repainting a rounded, filled box while its geometry
          animates — which is what the card and every platter are doing. And the
          weight was only one of four text properties in flight: size, tracking
          and colour all re-shape or re-paint the run too, and
          <code>font-size</code>
          is the one that re-shapes every glyph.
        </p>
        <p>
          The lesson is the ordinary one and it is worth stating plainly: a
          performance hypothesis you cannot measure is a guess, and shipping a
          guess costs complexity whether or not it was right. Bisect by
          disabling one suspect at a time in the browser that is slow.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>The handoff: real DOM, a flight, real DOM again</h3>
      <div class="dd-col">
        <p>
          No element is in both poses, and none can be: a
          <code>&lt;span&gt;</code>
          in flow and the value of an
          <code>&lt;input&gt;</code>
          cannot be the same node. So the type hands off, and the flight is the
          only copy of a value for as long as it lasts.
        </p>
        <p>
          Hiding the real value while the flight draws it wants
          <code>visibility</code>, not
          <code>opacity</code>
          and not
          <code>color</code>. A participant's opacity belongs to the engine — it
          renders one inline, so a stylesheet rule is simply outvoted — and
          <code>color: transparent</code>
          was outspecified by the two rules that give the reading view its type
          scale, so two of the three values showed through the flight as a
          doubled, offset copy of themselves.
        </p>
        <p>
          The two directions are NOT mirror images. Leaving the form there is a
          departing control still holding the value at full strength, so the
          word fades up against it and the pair crossfades — which is only
          invisible because the two are the same pixels. Entering there is no
          such partner: the reading string is not a participant, it simply
          unmounts, so a word that ramps from zero against nothing is the value
          going missing for a fifth of a second. The fade has to ask which way
          it is going.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>Controls you did not author</h3>
      <div class="dd-col">
        <p>
          A design system's field is a black box with an opinion about where its
          text sits, and the flight has to land on that opinion exactly.
        </p>
        <p>
          A
          <code>&lt;select&gt;</code>
          paints its value at an inset the browser chooses and does not report.
          With default padding that was eighteen pixels — a word landing
          eighteen pixels from where it belonged. Stripped to
          <code>appearance: none</code>
          and zero padding it paints at its content edge, and the ~14px the
          engine reserves turns out to be on the right, for the indicator. If it
          had been on the left, the only correct answer would be to draw the
          value yourself and let the control keep only its behaviour.
        </p>
        <p>
          And the widths have to be MEASURED with the same tool as the landing
          marks. The date's three chips are sized from pretext measurements of
          the widest value each will ever hold, and the flight's x for each word
          is derived from those same numbers. A hardcoded 104 is a number that
          was right for "September" in one face at one size and silently wrong
          the moment any of those changed.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>What stays cheap</h3>
      <div class="dd-col">
        <p>
          Only opacity and transform composite. Everything else on a moving box
          is a repaint, so each property gets the treatment it can survive.
        </p>
        <p>
          <b>Shadows are drawn once.</b>
          A shadow is not composited: every frame that changes one re-rasterises
          the box it sits on. The form's depth is a layer of its own at a FIXED
          size, never moved and never resized, carrying four shadows painted at
          full strength — and only its opacity animates, while the card grows
          into it.
        </p>
        <p>
          <b>Colours are transitioned, corners are tweened.</b>
          A colour cannot smear under a moving box, so the platter's border and
          fill are left to a CSS transition. A corner carried by a crop-scale IS
          a corner that smears, so the radius rides a tween beside the move. And
          the platter's border is 1px in both poses and merely changes colour,
          so the box does not resize when the form arrives.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>Testing a thing whose bugs are all mid-flight</h3>
      <div class="dd-col">
        <p>
          Almost every defect here was invisible in a still frame and obvious in
          motion, which makes the assertions unusual. The ones that earn their
          place sample frame by frame: that a line's word origins stay between
          their two poses and never cross; that the platters' boxes belong to
          the move for more than one frame; that nothing a field holds is ever
          outside it.
        </p>
        <p>
          Two harness facts are worth knowing before writing any of them. QUnit
          scales
          <code>#ember-testing</code>
          by half, so
          <code>getBoundingClientRect</code>
          returns numbers that are not the ones the component computed — recover
          the scale from an element that knows its width in both spaces, or
          assert in a scale-free space like the gap between two boxes. And under
          that scale some projections do not run at all, so an assertion about
          the header's first frame fails on the harness rather than the code.
          Where that happens, assert that the LIBRARY owns the box — it writes
          width and transform inline while a move plays — and verify the
          geometry by hand in a browser.
        </p>
      </div>
    </section>

    <section class="dd">
      <h3>If you are building one of these</h3>
      <div class="dd-col">
        <p>
          The order that would have saved this session the most time:
        </p>
        <p>
          <b>1.</b>
          Decide the two layers first — boxes that nest, type that crosses —
          before any of the animation. Most of the bugs above were the two being
          tangled.
        </p>
        <p>
          <b>2.</b>
          Derive everything from the form's field list, and hand the stylesheet
          its numbers rather than repeating them.
        </p>
        <p>
          <b>3.</b>
          Position every animated box by an edge, from a number. No
          <code>align-self</code>, no percentage translate, no flex sibling,
          <code>minmax(0, …)</code>
          on every track.
        </p>
        <p>
          <b>4.</b>
          Put the mode flag inside the region, and publish both poses' geometry
          so nothing outside it changes when the mode does.
        </p>
        <p>
          <b>5.</b>
          Take the type out of flow and measure both poses off-DOM. Then make
          the measured text and the rendered text agree — gap, width axis,
          tracking, line box — before tuning a single curve.
        </p>
        <p>
          <b>6.</b>
          Only then choose durations. Everything on one clock unless a
          constraint says otherwise; the one exception here is the leave fade,
          which has to close before the departing copy and the flight have moved
          apart.
        </p>
      </div>
    </section>
  </section>
</template>;

export default InlineEditNotes;
export { InlineEditNotes };
