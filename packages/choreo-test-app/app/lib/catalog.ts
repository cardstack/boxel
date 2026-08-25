import { BuildOrder } from 'test-app/components/examples/build-order';
import { Camera } from 'test-app/components/examples/camera';
import { DragWell } from 'test-app/components/examples/drag-well';
import { Enter } from 'test-app/components/examples/enter';
import { FarMatch } from 'test-app/components/examples/far-match';
import { FollowPointer } from 'test-app/components/examples/follow-pointer';
import { Gestures } from 'test-app/components/examples/gestures';
import { HideHeader } from 'test-app/components/examples/hide-header';
import { Inbox } from 'test-app/components/examples/inbox';
import { Interrupt } from 'test-app/components/examples/interrupt';
import { Keyframes } from 'test-app/components/examples/keyframes';
import { LayoutToggle } from 'test-app/components/examples/layout-toggle';
import { Lightbox } from 'test-app/components/examples/lightbox';
import { Lists } from 'test-app/components/examples/lists';
import { Parallax } from 'test-app/components/examples/parallax';
import { PathDraw } from 'test-app/components/examples/path-draw';
import { Playhead } from 'test-app/components/examples/playhead';
import { PresenceModes } from 'test-app/components/examples/presence-modes';
import { Presentation } from 'test-app/components/examples/presentation';
import { ReorderGrid } from 'test-app/components/examples/reorder-grid';
import { ReorderList } from 'test-app/components/examples/reorder-list';
import { Reveal } from 'test-app/components/examples/reveal';
import { Sequence } from 'test-app/components/examples/sequence';
import { SharedTabs } from 'test-app/components/examples/shared-tabs';
import { Sheet } from 'test-app/components/examples/sheet';
import { Slides } from 'test-app/components/examples/slides';
import { SplitView } from 'test-app/components/examples/split-view';
import { Stagger } from 'test-app/components/examples/stagger';
import { Subdivision } from 'test-app/components/examples/subdivision';
import { Trail } from 'test-app/components/examples/trail';
import { Wires } from 'test-app/components/examples/wires';
import { BuildOrderNotes } from 'test-app/components/notes/build-order';
import { CameraNotes } from 'test-app/components/notes/camera';
import { FarNotes } from 'test-app/components/notes/far';
import { InboxNotes } from 'test-app/components/notes/inbox';
import { InterruptNotes } from 'test-app/components/notes/interrupt';
import { LayoutNotes } from 'test-app/components/notes/layout';
import { LightboxNotes } from 'test-app/components/notes/lightbox';
import { PlayheadNotes } from 'test-app/components/notes/playhead';
import { PresenceNotes } from 'test-app/components/notes/presence';
import { PresentationNotes } from 'test-app/components/notes/presentation';
import { SequenceNotes } from 'test-app/components/notes/sequence';
import { SheetNotes } from 'test-app/components/notes/sheet';
import { SubdivisionNotes } from 'test-app/components/notes/subdivision';
import { TrailNotes } from 'test-app/components/notes/trail';
import { WiresNotes } from 'test-app/components/notes/wires';

export const groups = [
  'Animate',
  'Layout',
  'Drag',
  'Scroll',
  'Choreo',
  'Timeline',
] as const;

export type DemoGroup = (typeof groups)[number];

export interface DemoEntry {
  Example: any;
  apis: string[];
  group: DemoGroup;
  id: string;
  lede: string;
  /**
   * The long half: how the demo works, rendered under the usage example.
   *
   * A component rather than more prose in this file, because the ones worth
   * writing are mostly diagrams. Optional — most demos are one idea, and the
   * sample above says it.
   */
  notes?: any;
  sample: string;
  /**
   * Whether the stage honours `setMotionSpeed`, and so gets the speed control.
   *
   * Transitions are scaled on their way to the engine, which covers value
   * animations, choreography and — since the projection tree reads the
   * element's own `transition` — layout animations too. What it cannot reach
   * is motion with no transition to scale: anything driven by the pointer or
   * the scroll position, and anything animated by an imperative `animate()`
   * call the stage makes itself. Those opt out.
   */
  slowmo: boolean;
  title: string;
}

export const catalog: DemoEntry[] = [
  {
    Example: Playhead,
    apis: ['c.run', 'run.time', '@name', 'at()', 'c.Spring'],
    group: 'Timeline',
    id: 'playhead',
    lede: 'A hand that clicks for you. Drag the playhead and watch it think.',
    notes: PlayheadNotes,
    sample: `// The score IS the template: holds and walks in sequence flow, each press
// a NAMED dip of the hand, and the app's own value changes anchored to the
// press by name — \`at 'press-express' 0.55\` is the moment the finger lands.
<c.Sequence>
  <c.Wait @of={{hand}} @duration={{0.34}} />
  <c.Tween @of={{hand}} @x={{this.walkX 'home' 'express'}}
    @y={{this.walkY 'home' 'express'}} @duration={{0.62}} />
  <c.Tween @name='press-express' @of={{hand}}
    @scale={{array 1 0.74 1}} @duration={{0.22}} />
  <c.Spring @at={{at 'press-express' 0.55}}
    @of={{pill}} @x={{array 0 127}} @spring={{PILL}} />
  …
</c.Sequence>

// One description of what a press does. The buttons run it on click, and
// the transport folds it over the presses behind the playhead — so a
// scrubbed state cannot drift from a clicked one.
function press(state, cue) {
  switch (cue) {
    case 'express': return { ...state, speed: 'express' };
    case 'wrap':    return { ...state, wrap: !state.wrap };
    …
  }
}

// PLAYING — run.play(). The transport reads run.time and fires a real
// .click() on the real control as each press's moment goes by; the app's
// own handler is what changes the app.
this.stage.querySelector(\`[data-cue="\${cue}"]\`).click();

// SCORED — run.pause(); run.time = t. A scrubbed frame is the library's
// computed still: every spring stood exactly where the score says t looks
// like, in either direction. The old private sampler — a poseAt re-running
// Motion's generator — is deleted whole.

// LIVE — touch a control yourself and the template swaps the score for a
// handful of state-target springs: the app behaves like the plain app it
// is, and Play, Reset or the scrubber take the scene back by recomputing.
{{#if this.isLive}}
  <c.Spring @of={{pill}} @x={{this.pillX}} @spring={{PILL}} />
{{else}}
  …the score…
{{/if}}`,
    slowmo: false,
    title: 'Playhead',
  },
  {
    Example: Lightbox,
    apis: ['layoutId', 'LayoutGroup', 'Presence'],
    group: 'Layout',
    id: 'lightbox',
    lede: 'Extra fields dissolve. The plate goes home.',
    sample: `{{! Two layoutId pairs, not one: the plate carries the tile's shape, and the
    LABEL travels on its own so it can grow at its own rate. Both boxes are
    shrink-to-fit, so they differ only in font-size — same aspect ratio, so
    the text scales cleanly instead of stretching. }}
<button {{on 'click' (fn this.choose photo)}}>
  <span {{motion layoutId=(cardId photo.id) transition=spring}}>
    <span {{motion layoutId=(nameId photo.id) transition=spring}}>
      {{photo.label}}
    </span>
  </span>
</button>

<Presence @items={{this.overlay}} @key={{keyOf}} as |photo h|>
  {{! the scrim is a plain fade — it has no counterpart to morph into }}
  <button {{motion presence=h initial=fade animate=fadeOn exit=fade}}></button>

  <span {{motion layoutId=(cardId photo.id) transition=spring}}>
    <span {{motion layoutId=(nameId photo.id) transition=spring}}>
      {{photo.label}}
    </span>
    {{! only the big version has these, so they dissolve rather than travel }}
    <dl {{motion presence=h initial=fade animate=fadeOn exit=fade}}></dl>
  </span>
</Presence>`,
    notes: LightboxNotes,
    slowmo: true,
    title: 'Lightbox',
  },
  {
    Example: Inbox,
    apis: ['beacon', 'Move @from', 'Move @to'],
    group: 'Choreo',
    id: 'inbox',
    lede: 'Out of the button. Into the bin.',
    sample: `{{! Compose and Trash live in the chrome, OUTSIDE the region. Neither is a
    participant — a beacon is never inserted, kept or removed, and moving one
    never starts a run. It only says where it is. }}
<button type='button' {{beacon 'compose'}}>Compose</button>
<span {{beacon 'trash'}}></span>

<Choreo class='inbox-list' as |c|>
  {{#each this.rows key='id' as |row|}}
    <button {{motion id=row.id role='row'}}>{{row.from}}</button>
  {{/each}}

  <c.Parallel>
    {{! a new row borrows Compose's box as a start it never had }}
    <c.Move @of={{c.inserted 'row'}} @from={{c.beacon 'compose'}} @spring={{toss}} />

    {{! a deleted row borrows Trash's box as an end it never reaches.
        layoutId could not do this: it pairs two REAL elements and morphs
        one into the other, so the bin itself would stretch. }}
    <c.Move @of={{c.removed 'row'}} @to={{c.beacon 'trash'}} @spring={{toss}} />
    <c.Tween @of={{c.removed 'row'}} @opacity={{0}} @duration={{0.38}} />

    {{! and the tray closes up around the gap }}
    <c.Move @of={{c.moved 'row'}} @spring={{quick}} @size={{false}} />
  </c.Parallel>
</Choreo>`,
    notes: InboxNotes,
    slowmo: true,
    title: 'Beacons',
  },
  {
    Example: Sequence,
    apis: ['Choreo', 'Sequence', 'Hold', 'Move'],
    group: 'Choreo',
    id: 'sequence',
    lede: 'Fade, then move, then fade. Layers held for exactly that long.',
    sample: `<Choreo as |c|>
  <button
    {{motion
      id=card.id
      role=(roleOf card this.open)
      layout=true
      transition=soft
    }}
  >
    {{! SCALE CORRECTION, and easy to miss. The card grows from a square tile
        to a 16:9 hero by TRANSFORM, so scaleX and scaleY differ wildly and
        everything inside inherits that scale — text comes out smeared. A
        child with its own layout is measured in its own right, and
        projection undoes whatever scale its parent is applying. }}
    <span {{motion layout=true transition=soft}}>{{card.label}}</span>

    {{#if open}}
      <span {{motion id=detailsId role='card-content' layout=true}}>…</span>
    {{/if}}
  </button>

  <c.Sequence>
    {{! Layers, held for the rest of the sequence and released the moment it
        ends — no timers to clear, no flags left set if you click again }}
    <c.Hold @of={{c.role 'card'}} @zIndex={{1}} />
    <c.Hold @of={{c.role 'hero'}} @zIndex={{2}} />

    <c.Parallel>
      <c.Hold  @of={{c.removed 'card-content'}} @zIndex={{1}} />
      <c.Tween @of={{c.removed 'card-content'}} @opacity={{0}} @duration={{0.22}} />
    </c.Parallel>

    {{! The geometry belongs to projection (layout=true), because animating a
        grid item's width would distort every track around it. Choreo owns
        the ORDERING. The Wait holds the sequence open for the length of that
        move, and the new details fade in partway THROUGH it — so the card
        arrives already carrying its content. }}
    <c.Parallel>
      <c.Wait  @of={{c.all}} @duration={{0.56}} />
      <c.Tween
        @of={{c.inserted 'card-content'}}
        @opacity={{array 0 1}} @delay={{0.17}} @duration={{0.3}}
      />
    </c.Parallel>
  </c.Sequence>
</Choreo>`,
    notes: SequenceNotes,
    slowmo: false,
    title: 'Sequence',
  },
  {
    Example: Interrupt,
    apis: ['Choreo', 'Move', 'velocity'],
    group: 'Choreo',
    id: 'interrupt',
    lede: 'Change your mind halfway.',
    sample: `{{! A puck is not positioned — it is RENDERED into one slot or another, and
    the region works out that the same id is somewhere new. Two rails, the
    same clicks, differing only in what carries the puck. }}
<Choreo @id='spring' as |c|>
  {{#each stations as |station|}}
    <span class='slot'>
      {{#if (this.isAt station)}}
        <span {{motion id='puck' role='puck'}}></span>
      {{/if}}
    </span>
  {{/each}}

  {{! Retarget mid-flight and the run being replaced hands over how fast
      everything was going, so the new spring is born already travelling. It
      bends toward the new station, and overshoots if you send it back the way
      it came. That is momentum, and it is not scripted anywhere. }}
  <c.Move @of={{c.kept 'puck'}} @spring={{carry}} @size={{false}} />
</Choreo>

<Choreo @id='tween' as |c|>
  …same markup…

  {{! A tween has a start, an end and a curve between them, so interrupting it
      can only mean starting a NEW curve from wherever it happens to be — it
      stops dead and eases away again. Nothing is broken; it is what a
      duration means. }}
  <c.Move @of={{c.kept 'puck'}} @duration={{0.62}} @ease='easeInOut' @size={{false}} />
</Choreo>`,
    notes: InterruptNotes,
    slowmo: true,
    title: 'Interruption',
  },
  {
    Example: Slides,
    apis: ['Choreo', 'Move', 'layout', 'borderRadius'],
    group: 'Choreo',
    id: 'slides',
    lede: 'Three compositions. The same four things.',
    sample: `{{! Every slide renders the SAME elements. Only the stylesheet, keyed on
    data-slide, says where they are — so the region sees four participants
    that moved, and nothing that was replaced. }}
<Choreo class='slide' data-slide={{this.slide}} as |c|>
  <span class='slide-plate' {{motion id='plate' role='plate'}}></span>

  {{! Two mechanisms, and the difference is the lesson.

      The PLATE moves with c.Move — a real box animation of left/top/width/
      height. It is absolutely positioned, so nothing reflows around it, and
      its gradient and shadow are re-rendered at every size instead of being
      stretched. A projected plate would be a 36px square scaled up six times
      on one axis, and it would look it.

      The TYPE moves with layout=true — projection — because the title is a
      different font-size on every slide, and projection animates between two
      real sizes rather than resizing a box around text that has already
      jumped. It reads cleanly only because each box is fit-content. }}
  <b {{motion id='title' role='type' layout=true transition=type}}>Kiln</b>
  <small {{motion id='kicker' role='type' layout=true transition=type}}>
    Night shift
  </small>

  {{#if this.note}}
    <em {{motion id='note' role='note'}}>{{this.note}}</em>
  {{/if}}

  <c.Parallel>
    <c.Move @of={{c.moved 'plate'}} @spring={{plate}} />

    {{! The corner radius is the thing the View Transition version of this demo
        could not do at all: the radius belongs to the layout being
        transitioned between, so there was nothing to interpolate, and it had
        to be carried across by hand in a pair of custom properties. On a
        timeline it is one more animated property. }}
    <c.Tween @of={{c.all 'plate'}} @borderRadius={{radiusFor this.slide}} @duration={{0.42}} />

    {{! the note is the only thing that comes and goes: out fast, in late, so
        a slide is never carrying two of them }}
    <c.Tween @of={{c.removed 'note'}} @opacity={{0}} @duration={{0.14}} />
    <c.Tween
      @of={{c.inserted 'note'}}
      @opacity={{array 0 1}}
      @delay={{0.22}}
      @duration={{0.26}}
    />
  </c.Parallel>
</Choreo>`,
    slowmo: true,
    title: 'Slides',
  },
  {
    Example: Camera,
    apis: ['c.Camera', '@fit', '@margin', '@steady'],
    group: 'Choreo',
    id: 'camera',
    lede: 'The whole library sits on the glass. Dive in to grade a shot.',
    notes: CameraNotes,
    sample: `{{! A photo library: the whole set sits on the glass.
    Dive IN and the camera info develops — number first, then the full
    exposure. ONE step, aimed by state — an interrupted dive simply bends.

    @fit is the whole dive: the library computes the zoom AND the
    centring pan from the clicked frame's REST-layout box and the glass
    it has to fit inside — so a click straight from one dive to the next
    tile still measures true geometry, not whatever was mid-flight.
    @margin is the frame's share of the glass once centred; null fits
    nothing — back to the resting sheet. }}
<c.Parallel>
  <c.Camera
    @fit={{if this.focus (c.id this.focus) null}}
    @margin={{0.72}}
    @spring={{carry}}
    @steady={{array (c.role 'no') (c.role 'heart') (c.role 'verdict')}}
  />

  {{! if a verdict reflows the sheet, every frame that moved tweens }}
  <c.Move @of={{c.moved 'frame'}} @spring={{settle}} />
</c.Parallel>

{{! @steady keeps take numbers and the other tiles' marks legible while
    the camera flies. Heart and pass on the open frame live in the dock,
    off the photograph. For a pinch-anchored zoom that should NOT
    recentre, @origin/@x/@y are still there — @fit is the canned form of
    the common case: dive on this thing, and centre it. }}`,
    slowmo: true,
    title: 'Camera',
  },
  {
    Example: Presentation,
    apis: ['c.Gate', 'c.advance', 'Presence', 'nested Choreo'],
    group: 'Timeline',
    id: 'presentation',
    lede: 'The clock waits for you.',
    notes: PresentationNotes,
    sample: `// A presentation is a run that parks. The click does not start an
// animation — it opens a gate in a score that is already compiled.
// Linger and the next beat has not begun. Mash mid-build and the
// segment completes instantly (Keynote's click-through), then parks.
<c.Sequence>
  <c.Tween @of={{c.id 'title'}} @opacity={{array 0 1}}
    @x={{array -18 0}} @duration={{0.48}} @ease='easeOut' />
  <c.Gate @delay={{0.72}} />   {{! the kicker writes itself — you did not click }}
  <c.Tween @of={{c.id 'kicker'}} @opacity={{array 0 1}} @duration={{0.36}} />
  <c.Gate />
  <c.Parallel>
    <c.Move @of={{c.id 'hull'}} @from={{c.beacon 'approach'}}
      @path={{APPROACH}} @rotate='auto' @duration={{1.28}} />
    <c.Tween @of={{c.id 'fairway'}} @pathLength={{array 0 1}} @duration={{1.28}} />
  </c.Parallel>
  <c.Gate />
  <c.Tween @of={{c.id 'stamp'}}
    @opacity={{array 0 1 1}} @scale={{array 0.86 1.08 1}} @duration={{0.46}} />
</c.Sequence>

// advance() is the only verb. play() would unpause a paused clock;
// a gate is a named still. Replay is the only reverse — the cursor
// only ever moves forward through one pass.`,
    slowmo: true,
    title: 'Presentation',
  },
  {
    Example: Wires,
    apis: ['c.Tether', '@path', 'c.Move', 'c.inserted'],
    group: 'Timeline',
    id: 'wires',
    lede: 'Hover a mark. The comment still has hold.',
    notes: WiresNotes,
    sample: `// A wire is not a tween from A to B. @path is asked every frame (and
// every still) with both sprites' current boxes. One function: a cubic.
// Hover a highlight or a comment to see it. Step V1 → V2 → V3 and the
// draft grows — marks walk, comments update, threads stay attached.
<c.Parallel>
  <c.Move @of={{c.moved}} @spring={{GLIDE}} />
  <c.Tween @of={{c.inserted 'note'}} @opacity={{array 0 1}} @duration={{0.32}} />
  <c.Tether @from={{c.id 'm-gauge'}} @to={{c.id 'c-gauge'}}
    @path={{PATH_GAUGE}} />
  <c.Tether @from={{c.id 'm-edition'}} @to={{c.id 'c-edition'}}
    @path={{PATH_EDITION}} />
  <c.Tether @from={{c.id 'm-hed'}} @to={{c.id 'c-hed'}}
    @path={{PATH_HED}} />
</c.Parallel>

// Maya's comment keeps its name as the highlight walks down the draft.
// Jo's is inserted at V2. Step back and that tether follows the leaver.`,
    slowmo: true,
    title: 'Wires',
  },
  {
    Example: ReorderGrid,
    apis: ['ReorderGroup', 'axis="xy"'],
    group: 'Drag',
    id: 'grid',
    lede: 'Drag one cover anywhere in the grid.',
    sample: `{{! axis='xy' frees both axes, so a cover can displace diagonally. The drop
    target is found by NEAREST CENTRE rather than by crossing an edge —
    which is the only thing that works once a row can wrap. }}
<ReorderGroup
  @values={{this.items}}
  @onReorder={{this.setItems}}
  @axis='xy'
  as |group|
>
  {{#each this.items as |album|}}
    <ReorderItem
      @group={{group}}
      @value={{album}}
      @transition={{snap}}
      @whileDrag={{to scale=1.06 zIndex=4}}
    >{{album.label}}</ReorderItem>
  {{/each}}
</ReorderGroup>`,
    slowmo: true,
    title: 'Reorder grid',
  },
  {
    Example: SharedTabs,
    apis: ['layoutId'],
    group: 'Layout',
    id: 'tabs',
    lede: 'One highlight. It moves.',
    sample: `<LayoutGroup>
  {{#each tabs as |tab|}}
    <button type='button' {{on 'click' (fn this.select tab)}}>
      {{! The highlight UNMOUNTS here and MOUNTS under the next tab — two
          different elements that never coexist. Sharing one layoutId makes
          the engine treat them as the same thing, so the new one animates
          from the old one's box instead of appearing. }}
      {{#if (eq tab this.selected)}}
        <span {{motion layoutId='tab-pill' transition=pill}}></span>
      {{/if}}
      {{tab}}
    </button>
  {{/each}}
</LayoutGroup>`,
    slowmo: true,
    title: 'Shared layout',
  },
  {
    Example: FarMatch,
    apis: ['Choreo @id', 'far match', 'counterpart'],
    group: 'Choreo',
    id: 'far',
    lede: 'One name, three scenes.',
    sample: `{{! Three bays, three <Choreo> regions. A region reconciles its OWN
    participants and nothing else \u2014 that is what makes nesting work, and it is
    why a piece leaving one and arriving in another is normally a death here
    and an unrelated birth there.

    Every region that will animate this pass announces while Glimmer is still
    rendering. Then all of them MEASURE, then ids are MATCHED across regions,
    then each RUNs its own timeline. Three phases, no frame in between. }}
{{#each bays as |bay|}}
  <Choreo @id={{bay.id}} as |c|>
    <div {{motion id=bay.id role='bay'}}>
      {{#each (this.piecesIn bay.id) key='id' as |piece|}}
        {{! the same bare id in every bay is what lets the barrier pair the two
            halves. Prefixing it with the bay is the whole of \u2018off\u2019. }}
        <button {{motion id=(this.idFor piece bay.id) role='piece'}}>
          {{piece.label}}
        </button>
      {{/each}}
    </div>

    <c.Parallel>
      {{! One rule covers both halves, because to a region they are the same
          job: every piece that is somewhere new moves there. A neighbour
          closing a gap has a small delta; a piece that arrived from another
          bay has the delta between two bays \u2014 and only because the barrier
          handed it the sender\u2019s bounds to start from. }}
      <c.Move @of={{c.moved 'piece'}} @spring={{carry}} @size={{false}} />

      {{! a property may be a function of the sprite, and \u2018did you come from
          another region\u2019 is exactly what counterpart answers }}
      <c.Hold @of={{c.moved 'piece'}} @zIndex={{layer}} />

      {{! with matching on, neither of these fires: the sender is let go
          quietly by its own region, and the receiver is kept, not inserted }}
      <c.Tween @of={{c.removed 'piece'}} @opacity={{0}} @duration={{0.2}} />
      <c.Tween @of={{c.inserted 'piece'}} @opacity={{array 0 1}} @duration={{0.26}} />

      <c.Move @of={{c.moved 'bay'}} @spring={{settle}} />
    </c.Parallel>
  </Choreo>
{{/each}}

const layer = (sprite) => (sprite.counterpart ? 6 : 1);`,
    notes: FarNotes,
    slowmo: true,
    title: 'Far match',
  },
  {
    Example: Subdivision,
    apis: ['onPan', 'layout', 'instantLayoutTransition'],
    group: 'Drag',
    id: 'subdivision',
    lede: 'Drag a seam. The grid is the sizes you leave.',
    sample: `{{! Two things are happening, and keeping them apart is the demo. }}

{{! LIVE — the seam is under the finger, so nothing may animate. Every update
    is wrapped, which tells the projection tree to take this change without
    animating it. A seam that lags behind the finger feels broken. }}
drag = (axis, event, info) => {
  const next = clamp(this.startAt + (info.offset.x / box.width) * 100);
  instantLayoutTransition(() => { this.col = next; });
};

{{! RELEASED — an ordinary state change, so the tiles spring into the new
    tracks. Same elements, same layout=true, opposite behaviour, decided
    entirely by whether the change was wrapped. }}
drop = () => { this.col = Math.round(this.col); };

<div class='subdivide' style='grid-template-columns:{{this.col}}% 1fr'>
  {{#each tiles as |tile|}}
    <button {{motion layout=true transition=settle}}>
      {{! 'position' moves this node without taking its parent's scale, so the
          type stays crisp while the tile changes shape }}
      <b {{motion layout='position' transition=settle}}>{{tile.label}}</b>
    </button>
  {{/each}}

  {{! the seams are their own elements, which is why clicking a tile can never
      start a pan — the gesture is not on the tiles at all }}
  <span
    {{motion
      onPanStart=(fn this.grab 'col')
      onPan=(fn this.drag 'col')
      onPanEnd=(fn this.drop 'col')
    }}
  ></span>
</div>`,
    notes: SubdivisionNotes,
    slowmo: false,
    title: 'Subdivision',
  },
  {
    Example: DragWell,
    apis: ['drag', 'dragConstraints', 'dragElastic', 'dragTransition'],
    group: 'Drag',
    id: 'drag',
    lede: 'Throw it. It coasts, then settles.',
    sample: `{{! constraints are the crop frame's box — pass the element itself, no ref
    object needed. dragElastic is how far past the edge the still may be
    pulled; dragTransition is the throw AFTER release, so a flick coasts
    and settles instead of stopping dead under the finger. }}
<div class='crop' {{this.bindFrame}}>
  <div
    {{motion
      drag=true
      dragConstraints=this.frame
      dragElastic=0.12
      dragDirectionLock=this.lock
      dragTransition=(inertia bounceStiffness=280 bounceDamping=34 power=0.28)
      onDragStart=this.grab
      onDragEnd=this.release
    }}
  ></div>
</div>`,
    slowmo: false,
    title: 'Drag',
  },
  {
    Example: Sheet,
    apis: ['drag="y"', 'dragConstraints', 'onDragEnd', 'animate'],
    group: 'Drag',
    id: 'sheet',
    lede: 'The finger lets go. The spring takes the same value.',
    sample: `{{! While the finger is down, drag='y' owns y. On release the gesture hands
    that value back and animate carries it to the detent that won — same
    element, same value, no remount and no jump.

    dragMomentum is off because the detent IS the destination; inertia would
    be a second opinion about where the sheet should end up. }}
{{! pose is {y: DETENTS[this.mode]}; limits are plain px, {top: 0, bottom: 262} }}
<div
  {{motion
    animate=this.pose
    transition=settle
    drag='y'
    dragConstraints=this.limits
    dragElastic=0.05
    dragMomentum=false
    onDragStart=this.grab
    onDragEnd=this.land
  }}
></div>

// Which detent wins is not the one nearest where the finger STOPPED — it is
// the one nearest where the throw was GOING. onDragEnd hands you the velocity;
// project a sixth of a second of it past the release point and pick from there.
land = (event, info) => {
  const released = this.startedAt + info.offset.y;
  const projected = released + info.velocity.y * 0.16;
  this.detent = nearest(projected);
};`,
    notes: SheetNotes,
    slowmo: false,
    title: 'Sheet',
  },
  {
    Example: SplitView,
    apis: ['Choreo', 'Spring', 'Sprite bounds'],
    group: 'Choreo',
    id: 'split',
    lede: 'A value read off another element’s measurement.',
    sample: `// A property function is handed the sprite and the whole changeset, so one
// element can be animated from ANOTHER element's measurement. The content's
// left edge is not styled anywhere — it is a keyframe pair read off wherever
// the bar was measured to be, before and after.
leftRange = (_s, cs) => {
  const bar = cs.sprite({ id: 'split-bar' });
  return [bar.initial.parent.width, bar.final.parent.width];
};

<Choreo class={{if this.split 'split is-split' 'split'}} as |c|>
  <aside {{motion id='split-bar'}} />
  <section {{motion id='split-content'}}>…</section>

  {{! the bar FLIPs and the content chases the bar's measurement on the SAME
      spring, so the two edges stay welded together the whole way }}
  <c.Parallel>
    <c.Move @of={{c.id 'split-bar'}} @spring={{firm}} />
    <c.Spring @of={{c.id 'split-content'}} @left={{this.leftRange}} @spring={{firm}} />
  </c.Parallel>
</Choreo>`,
    slowmo: true,
    title: 'Split view',
  },
  {
    Example: ReorderList,
    apis: ['ReorderGroup', 'ReorderItem', 'whileDrag'],
    group: 'Drag',
    id: 'reorder',
    lede: 'Pull a track out of line.',
    sample: `{{! Only the dragged track is lifted. Every OTHER track layout-animates into
    its new slot as the order changes underneath it — @onReorder fires as
    soon as the pointer crosses a neighbour's midpoint, not on drop. }}
<ReorderGroup
  @values={{this.items}}
  @onReorder={{this.setItems}}
  @axis='y'
  as |group|
>
  {{#each this.items as |track|}}
    {{! whileDrag holds for the whole gesture: lifted, and above its
        neighbours so it is never occluded by the row it is passing }}
    <ReorderItem
      @group={{group}}
      @value={{track}}
      @transition={{snap}}
      @whileDrag={{to scale=1.04 zIndex=3 boxShadow='0 12px 30px #0009'}}
    >{{track.title}}</ReorderItem>
  {{/each}}
</ReorderGroup>`,
    slowmo: true,
    title: 'Reorder',
  },
  {
    Example: LayoutToggle,
    apis: ['layout', 'layout="position"', 'LayoutGroup'],
    group: 'Layout',
    id: 'layout',
    lede: 'Same nodes. Pick the curve they travel on.',
    sample: `<LayoutGroup>
  {{! Nothing here animates by name. The class swap restyles the shelf, and
      layout=true animates each node from where it WAS to where it IS. }}
  <div class={{if this.grid 'shelf is-grid' 'shelf is-list'}}>
    {{#each records as |record|}}
      <div {{motion layout=true transition=this.curve}}>
        <div {{motion layout=true transition=this.curve}}></div>

        {{! layout='position' — the un-obvious one. A parent that changes
            SHAPE scales its whole subtree, and text under a non-uniform
            scale is smeared. 'position' moves this node without taking its
            parent's scale, so the type stays crisp the whole way. }}
        <div {{motion layout='position' transition=this.curve}}>
          <strong>{{record.title}}</strong>
        </div>
      </div>
    {{/each}}
  </div>
</LayoutGroup>`,
    notes: LayoutNotes,
    slowmo: true,
    title: 'Curves',
  },
  {
    Example: Lists,
    apis: ['Choreo', 'Move', 'counterpart'],
    group: 'Choreo',
    id: 'lists',
    lede: 'One name, two lists, one move.',
    sample: `{{! A name that moves lists is REMOVED from one column and INSERTED into the
    other — two different elements. Matching ids makes the new one carry the
    old one as its counterpart, so it flies from where the old one stood
    instead of appearing. }}
<Choreo as |c|>
  <div {{motion id='crew' role='column'}}>
    {{#each this.crew key='@identity' as |name|}}
      <button {{motion id=name role='name'}}>{{name}}</button>
    {{/each}}
  </div>
  <div {{motion id='bench' role='column'}}>
    {{#each this.bench key='@identity' as |name|}}
      <button {{motion id=name role='name'}}>{{name}}</button>
    {{/each}}
  </div>

  <c.Parallel>
    {{! @size={{false}} — the names only translate. Without it a Move would
        also animate width and height, and a name would visibly squash as it
        crossed between two columns of different widths. }}
    <c.Move @of={{c.kept 'name'}} @spring={{quick}} @size={{false}} />
    {{! the columns only change height — they never move }}
    <c.Move @of={{c.moved 'column'}} @spring={{quick}} />
    {{! the old copy vanishes at once; its counterpart is already flying }}
    <c.Hold @of={{c.removed 'name'}} @opacity={{0}} />
  </c.Parallel>
</Choreo>`,
    slowmo: true,
    title: 'Lists',
  },
  {
    Example: Stagger,
    apis: ['variants', 'staggerChildren'],
    group: 'Animate',
    id: 'stagger',
    lede: 'One label, a whole dock.',
    sample: `// A variant is a NAMED pose. Naming one on the parent cascades the
// name down to every descendant that has variants of its own, so the whole
// dock is animated by setting a single string in the template.
const grid = {
  hidden: {},
  show: { transition: { staggerChildren: 0.035, delayChildren: 0.06 } },
};
const tile = {
  hidden: { opacity: 0, scale: 0.6, y: 18 },
  show: { opacity: 1, scale: 1, y: 0 },
};

<div {{motion variants=grid initial='hidden' animate='show'}}>
  {{#each apps as |app|}}
    {{! a child declares only its poses; the parent decides WHEN, and
        staggerChildren spaces the starts out in sibling order }}
    <div {{motion variants=tile}}>{{app.name}}</div>
  {{/each}}
</div>`,
    slowmo: true,
    title: 'Stagger',
  },
  {
    Example: Trail,
    apis: ['Presence', 'popLayout', 'layout'],
    group: 'Animate',
    id: 'trail',
    lede: 'Push a path. Pop a crumb.',
    sample: `{{! popLayout lifts a leaving crumb out of flow the moment it exits, so the
    row closes up underneath it while it fades in place. Without it the gap
    would not shut until the exit had finished. }}
<Presence
  @items={{this.items}}
  @key={{keyOf}}
  @mode='popLayout'
  @initial={{false}}
  as |step h|
>
  {{! layout=true is what animates the SURVIVORS into the closed-up row —
      the exit poses below only describe the crumb that is leaving }}
  <span
    {{motion
      presence=h
      layout=true
      initial=(to opacity=0 x=-12)
      animate=(to opacity=1 x=0)
      exit=(to opacity=0 scale=0.92 x=8)
      transition=spring
    }}
  >{{step.label}}</span>
</Presence>`,
    notes: TrailNotes,
    slowmo: true,
    title: 'Trail',
  },
  {
    Example: Keyframes,
    apis: ['animate', 'keyframes'],
    group: 'Animate',
    id: 'keyframes',
    lede: 'A path through values.',
    sample: `// An array is a PATH of waypoints, not a from/to: one tween eases
// through all four in order. rotate and scale have the same number of stops,
// so they hit their waypoints together — mismatched lengths would drift.
const morph = {
  rotate: [0, 90, 210, 360],
  scale: [1, 0.82, 1.14, 1],
  borderRadius: ['34%', '50%', '28%', '34%'],
};
// the glow rides the same clock, so its pulse cannot drift out of phase
const glow = { opacity: [0.35, 0.7, 0.3, 0.35], scale: [1, 1.25, 0.9, 1] };
const transition = { duration: 1.35, ease: 'easeInOut', repeat: Infinity };

<div {{motion animate=glow transition=transition}}></div>
<div {{motion animate=morph transition=transition}}></div>`,
    slowmo: true,
    title: 'Keyframes',
  },
  {
    Example: Gestures,
    apis: ['variants', 'whileHover', 'whileTap'],
    group: 'Animate',
    id: 'gestures',
    lede: 'Hover. Press.',
    sample: `// while* poses are held for as long as the gesture holds, then
// release on their own — there is no pointerup handler to write. Naming them
// as VARIANTS means one press cascades through the whole globe: the core, the
// limb and both glow shells each read the same name and answer differently.
const core = {
  rest:  { scale: 1,    backgroundColor: '#ff7a45' },
  hover: { scale: 1.06, backgroundColor: '#ffb36a' },
  press: { scale: 0.42, backgroundColor: '#fff4e8' },  // collapsed and HOT
};

<button
  {{motion
    variants=body
    initial='rest'
    animate='rest'
    whileHover='hover'
    whileTap='press'
    whileFocus=focus
  }}
>
  {{! the glow is real elements on opacity and scale. Animating a multi-layer
      box-shadow STRING instead means re-parsing it every frame, which is
      what makes a shadow animation judder. }}
  <span {{motion variants=outer}}></span>
  <span {{motion variants=inner}}></span>
  <span {{motion variants=core}}>
    <span {{motion variants=limb}}></span>
  </span>
</button>`,
    slowmo: true,
    title: 'Gestures',
  },
  {
    Example: PresenceModes,
    apis: ['Presence', 'mode', 'exit'],
    group: 'Animate',
    id: 'presence',
    lede: 'Swap a notice. Watch the gap.',
    sample: `{{! The same list, the same poses, three modes — the only difference is
    what happens to the SPACE while one leaves and the next arrives.
      sync      both animate at once, and they overlap
      wait      the leaver finishes before the newcomer starts
      popLayout the leaver is lifted out of flow, so the gap closes now
    'Up next' below is the tell: it only moves under popLayout. }}
<Presence
  @items={{this.items}}
  @key={{keyOf}}
  @mode={{@mode}}
  {{! the first render is the resting state, not an entrance }}
  @initial={{false}}
  as |notice h|
>
  <article
    {{motion
      presence=h
      initial=(to opacity=0 y=18)
      animate=(to opacity=1 y=0)
      exit=(to opacity=0 y=-28)
    }}
  >{{notice.title}}</article>
</Presence>

{{! not in the Presence — it just gets out of the way, on its own spring }}
<div {{motion layout=true transition=restMove}}>Up next</div>`,
    notes: PresenceNotes,
    slowmo: true,
    title: 'Presence',
  },
  {
    Example: Parallax,
    apis: ['scrollProgress', 'transformValue', 'style'],
    group: 'Scroll',
    id: 'parallax',
    lede: 'One scroll value, five different rates.',
    sample: `// One scroll value, five different rates. There is no clock and no easing
// here: progress IS the animation, so it tracks the finger exactly and
// reverses the instant the scroll does.
scroll = scrollProgress();

// transformValue derives a NEW motion value from an existing one. Reading
// .get() inside registers the dependency, so these recompute themselves.
back = { y: transformValue(() => this.scroll.scrollYProgress.get() * -220) };
mid  = { y: transformValue(() => this.scroll.scrollYProgress.get() * -90) };
// the further back a layer sits, the more it moves — that difference is
// the entire depth cue
word = {
  y:       transformValue(() => this.scroll.scrollYProgress.get() * -320),
  opacity: transformValue(() => 1 - this.scroll.scrollYProgress.get() * 1.4),
};

<div {{this.scroll.container}}>
  <div {{motion style=this.back}}></div>
  <div {{motion style=this.mid}}></div>
  <p {{motion style=this.word}}>DEPTH</p>
</div>`,
    slowmo: false,
    title: 'Parallax',
  },
  {
    Example: Enter,
    apis: ['initial', 'animate', 'transition'],
    group: 'Animate',
    id: 'enter',
    lede: 'Two notices find their scale.',
    sample: `{{! Every notice is keyed, so replaying swaps IDENTITIES — the old ones
    exit while the new ones enter, rather than one list mutating in place }}
<Presence @items={{this.items}} @key={{keyOf}} @mode='popLayout' as |note h|>
  {{! initial is the pose painted BEFORE the first frame; animate is home.
      The transition is PER VALUE: opacity is a short tween because a fade
      reads as instant anyway, while scale and y are springs so the card
      arrives with weight. One blanket duration would flatten both. }}
  <article
    {{motion
      presence=h
      initial=(to opacity=0 scale=0.55 y=56)
      animate=(to opacity=1 scale=1 y=0)
      exit=(to opacity=0 scale=0.9 y=-20)
      transition=(perValue
        opacity=(tween duration=0.16)
        scale=(spring bounce=0.48 visualDuration=0.42)
        y=(spring bounce=0.38 visualDuration=0.42)
      )
    }}
  >{{note.title}}</article>
</Presence>`,
    slowmo: true,
    title: 'Enter',
  },
  {
    Example: Reveal,
    apis: ['whileInView', 'viewport.once', 'viewport.root', 'onViewportEnter'],
    group: 'Scroll',
    id: 'reveal',
    lede: 'An arrival happens once. An effect tracks the scroll.',
    sample: `{{! whileInView is a pose that plays when the element crosses into view.
    Two viewport settings side by side, because the difference is the lesson:
    the pours use once:true, so each arrives and then stays put however many
    times you scroll past. The shift markers use once:false, so they leave when
    they leave and play again on the way back.

    The column scrolls inside the stage rather than with the page, so the
    observer is handed that element as its root. Without it every row would
    count as in view the moment the card is on screen. }}
<div {{this.bind}}>            {{! the scroll container, captured as the root }}
  {{#each this.entries key='key' as |entry|}}
    {{#if entry.marker}}
      <div {{motion initial=parked whileInView=passing
                    viewport=(everyPass this.root) transition=sweep}}
      >{{entry.marker}}</div>
    {{else if entry.pour}}
      {{! onViewportEnter is the escape hatch: the pose animates the element,
          the callback counts the readout up on the same crossing }}
      <article
        {{motion
          initial=resting
          whileInView=arrived
          viewport=(band this.root)
          transition=rise
          onViewportEnter=(fn this.count entry.pour)
        }}
      >
        <b>{{entry.pour.label}}</b>
        <small>{{entry.pour.shown}}°</small>
        <i {{motion initial=flat whileInView=(bar entry.pour.fraction)
                    viewport=(band this.root) transition=fill}}></i>
      </article>
    {{/if}}
  {{/each}}
</div>

{{! amount is how much of a row has to be in the band before it counts as
    arrived; once unhooks the observer after the first crossing }}
function band(root)      { return { amount: 0.6, once: true,  root: { current: root } }; }
function everyPass(root) { return { amount: 0.6, once: false, root: { current: root } }; }

{{! onViewportEnter is the escape hatch for what a pose cannot do. The pose
    animates the element; the callback runs your own code on the same crossing. }}
count = (pour) => {
  const started = performance.now();
  const tick = (now) => {
    const t = Math.min((now - started) / 620, 1);
    pour.shown = Math.round(pour.heat * (1 - (1 - t) ** 3));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};`,
    slowmo: false,
    title: 'Reveal',
  },
  {
    Example: HideHeader,
    apis: ['scrollProgress'],
    group: 'Scroll',
    id: 'header',
    lede: 'Direction, not distance.',
    sample: `// Direction, not distance. Compare with the LAST y rather than a fixed
// threshold: scrolling down hides the bar, and ANY scroll up brings it
// back — even one pixel, even far down the thread.
scroll = scrollProgress();

follow = (y) => {
  this.travel += y - this.last;
  this.last = y;
  if (y <= 8) { this.hidden = false; this.travel = 0; return; }
  // a small accumulator, so a jittery trackpad cannot flap the bar
  if (this.travel > 8)       { this.hidden = true;  this.travel = 0; }
  else if (this.travel < -8) { this.hidden = false; this.travel = 0; }
};

get header() { return { y: this.hidden ? -72 : 0 }; }

<header {{motion style=this.header transition=tween}}></header>
<div {{this.scroll.container}}></div>`,
    slowmo: true,
    title: 'Hide header',
  },
  {
    Example: PathDraw,
    apis: ['pathLength'],
    group: 'Animate',
    id: 'path',
    lede: 'A stroke that remembers.',
    sample: `{{! pathLength is 0..1 of the stroke's OWN geometry, so the same animation
    draws any shape — no need to know how long the path really is, and no
    stroke-dasharray arithmetic. }}
const draw   = { opacity: 1, pathLength: 1 };
const sparkIn = { opacity: 1, pathLength: 0 };

<svg viewBox='0 0 100 100'>
  {{! the ring starts a beat later, so the two strokes read as one gesture }}
  <circle
    {{motion presence=h initial=ringIn animate=draw exit=hide transition=ring}}
  />
  <path
    d={{sparkPath}}
    {{motion presence=h initial=sparkIn animate=draw exit=hide transition=spark}}
  />
</svg>`,
    slowmo: true,
    title: 'Path',
  },
  {
    Example: FollowPointer,
    apis: ['motionValue', 'animate'],
    group: 'Drag',
    id: 'pointer',
    lede: 'Three springs after the hand.',
    sample: `// Three pairs of values chasing one pointer at three stiffnesses. The lag
// between them is not scripted — it falls out of the physics.
x = motionValue(0);
y = motionValue(0);

move = (event) => {
  // Every pointer move RETARGETS the running spring rather than starting a
  // new one: it keeps its current velocity and bends toward the new point.
  // That is why fast circles trace a smooth arc instead of a star.
  animate(this.x,  event.offsetX, tight);   // the orb, on the hand
  animate(this.rx, event.offsetX, mid);     // the ring, a beat behind
  animate(this.hx, event.offsetX, loose);   // the halo, last to arrive
};

<div {{motion style=(styles x=this.x y=this.y)}}></div>`,
    slowmo: false,
    title: 'Follow the pointer',
  },
  {
    Example: BuildOrder,
    apis: ['c.Sequence', '@name', 'at()/after()', '@by', 'c.run'],
    group: 'Timeline',
    id: 'build-order',
    lede: 'Keynote\u2019s build inspector, wired to the site\u2019s own logo. Retime it while it runs.',
    notes: BuildOrderNotes,
    sample: `// A build order, not a timeline. Nothing here is a timecode: a build
// names a part, an effect, and when it goes relative to the build above
// it — and the score is the template. \`with\` anchors on the previous
// build's START, \`after\` on its end; the compiler resolves the rest.
<c.Sequence>
  <c.Tween @name='b1' @of={{c.id 'plate'}}
    @opacity={{array 0 1 1 1}} @x={{array -38 0}}
    @ease='easeOut' @duration={{0.62}} />
  <c.Tween @name='b2' @at={{at 'b1'}} @delay={{0.14}}
    @of={{c.id 'tail'}} @pathLength={{array 0 1}} @duration={{0.52}} />
  <c.Tween @name='b3' @at={{after 'b2'}}
    @of={{c.id 'head'}} @pathLength={{array 0 1}} @duration={{0.52}} />
  …
  <c.Tween @name='b7' @at={{after 'b6'}} @delay={{0.06}}
    @of={{c.id 'word'}} @by='character'  // ← a second timeline, inside
    @opacity={{array 0 1 1}} @scale={{array 0.78 1}} @y={{array 18 0}}
    @ease='easeOut' @duration={{0.76}} />
</c.Sequence>

// An effect is nothing but keyframe values and an easing: Pop is a scale
// through backOut, and a build-in's leading opacity frames are Keynote's
// "builds in" — pinned hidden from the run's start until its window.

// The transport holds the run. Play, pause and the scrubber share one
// clock: \`time\` is settable in either direction, and a scrubbed frame
// is a computed still.
c.run.pause();
c.run.time = 1.4;   // the scrubber — and an edit replays the pass and
c.run.play();       // puts the new run back at the SAME t, so retiming
                    // build 2 while parked at 1.4s shows what 1.4s now is.

// The bars on the rail are read back from run.cues — the compiler's
// resolved answer, never a second copy of the schedule.`,
    slowmo: true,
    title: 'Build order',
  },
];

export function findDemo(id: string): DemoEntry | undefined {
  return catalog.find((demo) => demo.id === id);
}

export function neighbors(id: string): { next?: DemoEntry; prev?: DemoEntry } {
  const index = catalog.findIndex((demo) => demo.id === id);
  return {
    next: catalog[index + 1],
    prev: catalog[index - 1],
  };
}
