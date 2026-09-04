import { BuildOrder } from 'test-app/components/examples/build-order';
import { Camera } from 'test-app/components/examples/camera';
import { Crossing } from 'test-app/components/examples/crossing';
import { DragWell } from 'test-app/components/examples/drag-well';
import { Drift } from 'test-app/components/examples/drift';
import { Enter } from 'test-app/components/examples/enter';
import { Escort } from 'test-app/components/examples/escort';
import { FarMatch } from 'test-app/components/examples/far-match';
import { Fold } from 'test-app/components/examples/fold';
import { FollowPointer } from 'test-app/components/examples/follow-pointer';
import { Gestures } from 'test-app/components/examples/gestures';
import { Grip } from 'test-app/components/examples/grip';
import { Hang } from 'test-app/components/examples/hang';
import { HideHeader } from 'test-app/components/examples/hide-header';
import { Inbox } from 'test-app/components/examples/inbox';
import { InlineEdit } from 'test-app/components/examples/inline-edit';
import { Interrupt } from 'test-app/components/examples/interrupt';
import { Jump } from 'test-app/components/examples/jump';
import { Keyframes } from 'test-app/components/examples/keyframes';
import { LayoutToggle } from 'test-app/components/examples/layout-toggle';
import { Lightbox } from 'test-app/components/examples/lightbox';
import { Lists } from 'test-app/components/examples/lists';
import { LongTake } from 'test-app/components/examples/long-take';
import { Mockup } from 'test-app/components/examples/mockup';
import { Parallax } from 'test-app/components/examples/parallax';
import { PathDraw } from 'test-app/components/examples/path-draw';
import { Playhead } from 'test-app/components/examples/playhead';
import { PresenceModes } from 'test-app/components/examples/presence-modes';
import { Presentation } from 'test-app/components/examples/presentation';
import { Rack } from 'test-app/components/examples/rack';
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
import { CrossingNotes } from 'test-app/components/notes/crossing';
import { FarNotes } from 'test-app/components/notes/far';
import { FoldNotes } from 'test-app/components/notes/fold';
import { InboxNotes } from 'test-app/components/notes/inbox';
import { InlineEditNotes } from 'test-app/components/notes/inline-edit';
import { InterruptNotes } from 'test-app/components/notes/interrupt';
import { LayoutNotes } from 'test-app/components/notes/layout';
import { LightboxNotes } from 'test-app/components/notes/lightbox';
import { LongTakeNotes } from 'test-app/components/notes/long-take';
import { MockupNotes } from 'test-app/components/notes/mockup';
import { PlayheadNotes } from 'test-app/components/notes/playhead';
import { PresenceNotes } from 'test-app/components/notes/presence';
import { PresentationNotes } from 'test-app/components/notes/presentation';
import { RackNotes } from 'test-app/components/notes/rack';
import SagradaNotes from 'test-app/components/notes/sagrada';
import { SequenceNotes } from 'test-app/components/notes/sequence';
import { SheetNotes } from 'test-app/components/notes/sheet';
import { SubdivisionNotes } from 'test-app/components/notes/subdivision';
import { SylvaNotes } from 'test-app/components/notes/sylva';
import TowersNotes from 'test-app/components/notes/towers';
import { TrailNotes } from 'test-app/components/notes/trail';
import { WiresNotes } from 'test-app/components/notes/wires';
import { SagradaStage } from 'test-app/components/sagrada-stage';
import { SylvaStage } from 'test-app/components/sylva-stage';
import { TowerStage } from 'test-app/components/tower-stage';

export const groups = [
  'Animate',
  'Layout',
  'Drag',
  'Scroll',
  'Choreo',
  '3D',
  /* FILM holds exactly two: the pictures built on `<Film>`. They are 3D
     and they are Choreo and they are timeline work, and filing them
     under any one of those buries them — a film is its own kind of
     thing, and the two of them are the argument for the construct. */
  'Film',
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
  /**
   * The demo's own URL, when it has one — a film owns its name and is
   * not served from `/:demo_id`. The tile links here instead, and the
   * pager steps to it by route rather than by id.
   */
  route?: string;
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
  /**
   * Whether the stage is a film, and so has a theater to enter: the
   * player brought to the front of this page at the window's full
   * height, on `#theater`. See app/services/theater.ts.
   */
  theater?: boolean;
  title: string;
  /**
   * A walkthrough of the key concepts, under the usage example: the data
   * that actually drives the demo, quoted rather than described.
   * Optional — most demos are one idea and the sample above says it. The
   * films have one because a film IS a table, and the table is the thing
   * worth reading.
   */
  walkthrough?: { label: string; note: string; source: string }[];
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
    Example: InlineEdit,
    apis: ['c.Crossing', 'c.Move', 'c.Tween', 'createArming'],
    group: 'Choreo',
    id: 'inline-edit',
    lede: 'An employee profile, read and then written. Real fields at both ends.',
    sample: `// Real DOM, then a flight, then real DOM again.
//
//   1. the reading view's own markup — an ordinary string, in flow
//   2. a layer of words, out of flow, carrying the eye between the poses
//   3. real fields: a text input, an email input, a segmented date group
//
// No element is in both, and none can be. A <span> in flow and the value
// of an <input> cannot be the same node, and every attempt to make
// choreography pretend otherwise failed differently: two copies of a word
// sliding past each other while the arriving one relaid itself out; a line
// whose gaps went wrong in flight because each word travelled alone and
// nothing was interpolating the LINE — "14 March 1986" arriving as
// "14  March1986". The space between two words is a property of neither.

// WHAT IS MEASURED, AND BY WHOM. The containers are the LIBRARY's: a
// field's box before the swap and after it is exactly what a changeset is.
// There is no getBoundingClientRect in the demo, and there was — a
// hand-rolled FLIP re-deriving what the region had already measured.
<c.Move @of={{c.moved 'field'}} @duration={{MOVE}} @ease={{EASE}} />

// pretext measures the one thing the DOM cannot: where a word will sit in a
// pose that is NOT rendered. The form does not exist while the reading view
// is on screen, and in general it is not even the same author's component.
const view = layoutWords(words, VIEW[key], 0);      // canvas metrics,
const edit = layoutWords(words, EDIT[key], INSET);  // pure arithmetic

// One step, one journey per word: a step property may be a function of the
// sprite it is applied to, so the plan is read per element.
<c.Tween @of={{c.kept 'name-value'}} @x={{this.wordX}}
  @fontSize={{this.nameSize}} @fontWeight={{this.nameWeight}}
  @duration={{MOVE}} @ease={{EASE}} />

// Each of those is a KEYFRAME ARRAY — ['30px', '17px'] — not a target. The
// rest poses live in CSS keyed by [data-mode], so the new value is already
// on the element when the region measures; a step given one target finds it
// already there and animates nothing.

// NEVER TWO COPIES. The flight words are hidden at both ends and shown only
// while the region says a scene change is under way, and the real control's
// text stands aside for exactly that long. VISIBILITY, not opacity: a
// participant's opacity belongs to the engine, which renders one inline, so
// a stylesheet rule is simply outvoted.
private arming = createArming();
// .ie-word { visibility: hidden }
// .ie-card[data-flying] .ie-word { visibility: visible }

// wdth is said as font-stretch: 87.5%, not font-variation-settings — a
// variation axis cannot appear in the canvas font shorthand, so pretext
// would measure the wide cut while the screen drew the narrow one. Thirty
// pixels of error on a two-word name, all of it in the gaps.`,
    notes: InlineEditNotes,
    slowmo: true,
    title: 'In place',
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
    Example: Mockup,
    apis: ['c.Camera3D', '@onCamera3D', 'c.Perform', 'c.Camera'],
    group: '3D',
    id: 'mockup',
    lede: 'A phone you can turn, and an app you can still use.',
    notes: MockupNotes,
    sample: `{{! ONE SCORE, TWO LENSES. The beats are identical in both
    modes — the same apps open and close on the same counts — and only
    the camera differs. That symmetry is the argument for making the 3D
    camera a STEP rather than a callback. }}
<c.Parallel>
  {{! the beats: semantic commands on the timeline, not remembered
      clicks. A seek past one includes its result; a seek before it
      excludes it. }}
  <c.Sequence>
    {{#each SHOTS as |shot|}}
      <c.Wait @duration={{TRAVEL}} />
      <c.Perform @action='open' @target={{shot.app}} />
      <c.Wait @duration={{shot.hold}} />
      <c.Perform @action='close' @target={{shot.app}} />
    {{/each}}
  </c.Sequence>

  {{! the camera. c.Camera moves a region's own frame — a 2D transform
      on real DOM. A 3D scene has no such frame, so c.Camera3D carries
      only the POSE and the host draws with it. }}
  <c.Sequence>
    {{#each SHOTS as |shot|}}
      <c.Camera3D
        @yaw={{shot.yaw}} @pitch={{shot.pitch}} @dolly={{shot.dolly}}
        @duration={{TRAVEL}} @ease={{GLIDE}}
      />
      {{! the hold is not a hold: it closes in while the app is open }}
      <c.Camera3D @by={{true}} @dolly={{0.94}} @yaw={{6}}
        @duration={{shot.hold}} @ease={{GLIDE}} />
    {{/each}}
  </c.Sequence>
</c.Parallel>

// The host applies the pose to whatever it is actually drawing with.
// Choreo owns the clock and the easing; this is the whole adapter:
<Choreo @onCamera3D={{this.shot}} @onPerform={{this.dispatch}} as |c|>

shot = (pose) => {
  ry = Math.PI + (pose.yaw * Math.PI) / 180;
  rx = (pose.pitch * Math.PI) / 180;
  dolly = pose.dolly;          // x the distance the framing solved for
};

// A drag means "let me look" and stops the camera; a tap on the screen
// means "let me use it" and stops the cues. Two tracks, two switches.`,
    slowmo: false,
    title: 'Mockup',
  },
  {
    Example: SylvaStage,
    apis: ['@through', '@look', 'c.Perform', '@at / @delay'],
    group: '3D',
    id: 'sylva',
    lede: 'A moss world, live cards punched into it, toured by a camera that never stops.',
    notes: SylvaNotes,
    sample: `{{! ONE STEP IS THE WHOLE LAP: a title drift, eight reading
    waypoints and the way home, splined by @through on a single clock —
    the camera crosses every pose with continuous velocity, and the aim
    rides in the waypoints via @look. The ease is linear on purpose: the
    spline is the shape. }}
<c.Sequence @name={{this.lapName}}>
  <c.Camera3D @name='lap' @through={{this.lapPath}}
    @duration={{this.lapSeconds}} @ease='linear' />

  {{! presents, CLIPPED into the path: each open fires just before its
      card's waypoint is crossed, mid-flight — and each open SWAPS the
      cards, so the leaver and the arrival cross-fade while the camera
      is still travelling }}
  {{#each this.presents as |present|}}
    <c.Perform @at={{at 'lap'}} @delay={{present.open}}
      @action='open' @target={{present.id}} />
  {{/each}}

  {{! the last card lets go partway into the pull-out }}
  <c.Perform @at={{at 'lap'}} @delay={{this.lapClose}} @action='close' />
  <c.Perform @action='lap' />
</c.Sequence>`,
    slowmo: false,
    title: 'Sylva',
  },
  {
    Example: TowerStage,
    apis: ['<Film>', 'f.Spine', '@through', 'c.Attach', 'c.Perform'],
    group: 'Film',
    id: 'towers',
    lede: 'Not a video. A four-minute museum film composited live in the browser — a 3D scene, motion graphics and a score, cut in real time at any size, with interactive chapters and its own audio mixer.',
    notes: TowersNotes,
    route: 'towers',
    sample: `{{! THE SCORE IS THE EDITOR — and it is three things in one
    region, which is the whole of how a film composes with Choreo.

    ONE CAMERA STEP for the entire film. Every beat contributes waypoints
    to a single spline: a hold breathes, and a cut waypoint SPLICES the
    path so the shots either side are clamped rather than travelled
    between. Nothing else moves the lens — there is no per-shot camera.

    ONE ATTACHED WINDOW PER BEAT. The type, the insert and the clip are
    their own regions with their own steps, and the film does not PLAY
    them: it opens a window on its own clock and drives them through it.
    That is why a scrub lands every one of them where the clock says
    rather than where they had got to.

    AND, IN A CUT FILM, A CUE PER EDIT. An exact film has none at all: it
    derives the beat in force from the number, which is what makes it a
    pure function of its clock and what lets it be rendered frame by
    frame rather than recorded. }}

{{! THE CONSTRUCT, first: <Film> is the editor, and everything below is
    what it runs. The picture is a component rather than fourteen
    arguments — it declares the adjustments a shot may hold on it,
    f.picture.* — and the score is the graph in the default block. }}
<Film @name='towers' @menuTitle='TOWERS' @join='wipe'
  @rail={{false}} @seek={{this.seek}} @settle={{0.5}}>
  <:picture as |register|>
    <IframePicture @register={{register}}
      @src={{this.src}} @assets={{this.assets}} @standing={{STANDING}} />
  </:picture>
  <:default as |f|>
    <f.Spine>…chapters, shots and the joins between them…</f.Spine>
  </:default>
  <:gate as |f|>…the door: the title package, in the film's own type…</:gate>
  <:end as |f|>…the back matter…</:end>
</Film>

{{! AND THIS IS WHAT <Film> COMPILES ITS SCORE INTO — one region, three
    kinds of step. The film writes this; a score never does. }}
<c.Sequence @name={{this.filmName}}>
  {{! @settle averages the spline around the clock instead of chasing it:
      the curvature step at every waypoint goes, the cuts and the landing
      do not, and it stays a pure function of the clock }}
  <c.Camera3D @name='film' @through={{this.path}}
    @duration={{this.filmSeconds}} @ease='linear'
    @settle={{this.settle}} @tension={{0.34}} />

  {{! driven, never played — and @end says what happens past the window:
      taken off, held on its last sample, or frozen }}
  {{#each this.windows as |w|}}
    <c.Attach @region={{w.region}} @at={{at 'film'}}
      @delay={{w.start}} @duration={{w.length}}
      @end={{w.end}} @exact={{this.exact}} />
  {{/each}}

  {{#unless this.exact}}
    {{! the narration, the type, the stage marks, the traces, the grade
        and the weather all enter on these. A beat with a LEAD emits two:
        an 'air' cue a tick early, so the sky turns while the lens is
        still travelling, and then the 'beat' itself. }}
    {{#each this.cues as |cue|}}
      <c.Perform @at={{at 'film'}} @delay={{cue.delay}}
        @action={{cue.action}} @target={{cue.index}} />
    {{/each}}

    {{! and the last cue does not loop — a film that laps past its own
        coda never meant any of it. The run stops, the end card rises. }}
    <c.Perform @action='lap' />
  {{/unless}}
</c.Sequence>`,
    slowmo: false,
    theater: true,
    walkthrough: [
      {
        label: 'One shot, as the score writes it',
        note: `A film is a GRAPH — a spine of chapters and shots, with everything else attached to a shot — and it COMPILES to a table of beats the engine runs. Both are here on purpose: this is the source, the next panel is what it becomes. Every field is a FACT about the shot rather than a keyframe, which is what lets an agent direct the film by editing the score and a person direct it by dragging one number. Order inside a shot does not matter; a Join is a sibling BETWEEN two shots, because a seam belongs to neither.`,
        source: `<f.Join @presentation="dip" />
<f.Shot
  @name="ishigaki"       {{! the shot's name IS its place in the script }}
  @ticks={{7}}           {{! how long it runs: one tick is two seconds }}
  @cut={{true}}          {{! SPLICE the camera path, do not travel to it }}
  @dolly={{1.24}} @lookY={{-4.4}} @ox={{-0.12}} @pitch={{-1}} @yaw={{72}}
  @to={{array 2.8 1.6 0.6}}        {{! what the callouts point at }}
>
  {{! the tail pose: the shot travels here over its seven ticks }}
  <f.To @dolly={{1.12}} @lookY={{-3.2}} @ox={{-0.12}}
    @pitch={{1}} @yaw={{84}} />

  <f.Type @mode="lower" @kicker="STAGE ONE"
    @word="石垣" @reading="ISHIGAKI" @gloss="the stone base"
    @says={{array "No mortar. None." "The wall sheds the shock"}} />

  <f.Voice @line="Ishigaki. Dry stone, no mortar, stacked into a curve."
    @read={{get VO_SECS "ishigaki"}} />

  {{! adjustments the PICTURE declares, held for this shot only }}
  <f.picture.Build @clock={{array (tAt 1576) (tAt 1579)}} />
</f.Shot>`,
      },
      {
        label: 'The same shot, compiled',
        note: `What the graph above becomes: one row the engine reads. Five members are required — id, ch, cam, mode, ticks — and the other forty-odd are the direction. The compiler is pure and the rows are pinned by golden fixtures, so a change to the score that was not meant to move the film shows up as a diff rather than as a surprise four minutes in.`,
        source: `{
  id: 'ishigaki',            // from @name
  ch: 2,                     // from the enclosing chapter
  ticks: 7,
  mode: 'lower',             // from the Type
  cut: true,
  join: 'dip',               // from the Join before it
  cam:   { dolly: 1.24, lookY: -4.4, ox: -0.12, pitch: -1, yaw: 72 },
  toCam: { dolly: 1.12, lookY: -3.2, ox: -0.12, pitch: 1,  yaw: 84 },
  to: [2.8, 1.6, 0.6],
  build: [tAt(1576), tAt(1579)],
  kanji: '石垣',
  romaji: 'ISHIGAKI',
  gloss: 'the stone base',
  says: ['No mortar. None.', 'The wall sheds the shock'],
  vo: 'Ishigaki. Dry stone, no mortar, stacked into a curve.',
}`,
      },
      {
        label: 'The chapters',
        note: `Five rows, and the whole grade of the film. A beat names a chapter by index and inherits its mood and its film stock unless it overrides them — so a colourist's pass is five lines, not four hundred.`,
        source: `const CHAPTERS = [
  { n: '01', title: 'CONTEXT',      grade: 'amber', lut: 'sandstone' },
  { n: '02', title: 'HISTORY',      grade: 'iron',  lut: 'iron' },
  { n: '03', title: 'CONSTRUCTION', grade: 'chalk', lut: 'chalk' },
  { n: '04', title: 'DETAIL',       grade: 'ink',   lut: 'ink' },
  { n: '05', title: 'COMPARISON',   grade: 'plate', lut: 'plate' },
];`,
      },
      {
        label: 'A mood, as numbers',
        note: `A grade is not a filter name, it is the numbers the glass takes. The film hands the construct a table of them and a beat wears one by name; the shader interpolates between whichever two are in force across a seam.`,
        source: `const GRADES = {
  // the film's one night shot: a night that has been LIFTED is dusk, so
  // this one pulls the black down and leaves the rim light to draw
  night: {
    sat: 0.78, con: 1.12, bri: 0.7, sep: 0, hue: 0,
    warm: hex('#c9c2b4'),
    cool: hex('#6f7f9e'),
    gradeA: 0.6, vigA: 0,
  },
};`,
      },
    ],
    title: 'Towers',
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
    Example: Escort,
    apis: ['c.Follow', 'StepComponent', '@name'],
    group: 'Choreo',
    id: 'escort',
    lede: 'Read from the card, not animated with it.',
    sample: `// A composite step: a new word in the timeline, written in nothing but the
// published seam. Its children are generic, so a specific step beside it
// takes the sprite away without an exclusion syntax.
class Carry extends StepComponent {
  node() {
    return {
      kind: 'parallel',
      name: this.args.name,
      children: [
        { kind: 'move', generic: true, of: this.args.of, spring },
        { kind: 'hold', generic: true, of: this.args.of, props: { zIndex: 3 } },
      ],
    };
  }
}

// …and two values READ from the flight rather than animated with it. Neither
// can be a tween: a tween would have to know the spring's overshoot in
// advance, and what a mid-flight retarget does to it.
const pin = ({ self, sources: [card] }) => ({
  x: card.x + card.width - (self.x + self.width),
  y: card.y - self.y,
});

<c.Parallel>
  <Carry @name='carry' @of={{c.moved 'card'}} />
  <c.Follow @at={{at 'carry'}} @of={{c.id 'badge'}} @to={{c.id 'card'}}
            @read={{pin}} @rest={{PIN_REST}} @duration={{1.1}} />
</c.Parallel>`,
    slowmo: true,
    title: 'Escort',
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
    Example: Crossing,
    apis: ['c.Crossing', 'pack', 'createArming', 'c.Move'],
    group: 'Choreo',
    id: 'crossing',
    lede: 'Two skins cross inside one flying box. The video never stops.',
    sample: `// A CROSSING is the canned scene swap: leaves fade, the paired flight
// carries, arrivals land near the settle. It is written in nothing but
// the public step vocabulary — no privileged access, no snapshot.
<c.Parallel>
  {{! counterparts: same id, different content. Two skins, one box. }}
  <c.Crossing
    @duration={{tt.move}} @ease={{EASE}}
    @leave={{tt.leave}} @arrive={{tt.arrive}} @overlap={{0.18}} />

  {{! kept identities (the plate, the hairline) tween their REAL box —
      crop-cover would scale Tide's wide plate into Violet's square. }}
  <c.Move @of={{c.moved}} @duration={{tt.move}} @ease={{EASE}} />
</c.Parallel>

// The innards are NOT participants. A <video>, an auto-scrolling pane and
// a spinning mark reflow with the box and keep running mid-flight — the
// exact case a View Transition snapshot freezes into a still.
<div class='hero' {{motion id='hero' role='hero'}}>
  <video src={{CLIP}} muted loop autoplay playsinline></video>
  <div class='pane' {{liveScroll}}>…</div>
  {{! an inset caption INSIDE the plate is itself a counterpart, so a skin
      crosses while its parent is still flying }}
  <em {{motion id='inset' role='inset' pack='content'}}>{{s.inset}}</em>
</div>

// Drop-shadows do not tween. Tide's tight teal, Ember's huge warm and
// Violet's small black are three different LIGHTS: interpolating the
// box-shadow string reparses every frame and drags the colour through
// mud. Each rest shadow is its own caster; only opacity crossfades.
<span class='cast {{s.tone}}' data-slide={{s.n}}></span>

// A cut can land at any phase — including mid-flight. data-phase='crossing'
// stills the intra-slide CSS loops for the span of the run, because those
// are transforms on the motion nodes themselves and would fight the Move.`,
    notes: CrossingNotes,
    slowmo: false,
    title: 'Crossing',
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
    Example: Rack,
    apis: ['c.run', 'run.time', 'run.paused', 'c.Gate', 'c.Move'],
    group: 'Drag',
    id: 'rack',
    lede: 'Six arrangements, one score, and a clock you can hold.',
    sample: `{{! ONE score for the whole journey, not one per leg.

    A changeset has two ends, so five stops looks at first like four scores
    with the host swapping between them. It is not: a keyframe array is the
    from-and-to AND ANY WAYPOINTS in one value. Six stops per property is one
    score, the DOM never changes, and the region compiles exactly once. }}
<Choreo class='rk-stage' as |c|>
  <span data-take={{this.take}} {{this.wire c}}></span>

  {{! every tile states all six of its seats; nothing here re-renders }}
  {{#each this.letters as |l|}}
    <span class='rk-l' {{motion id=l.key role='tile'}}>{{l.ch}}</span>
  {{/each}}

  {{! furniture appears only where it is TRUE — one number per stop }}
  <span class='rk-grid' {{motion id='grid' role='game'}}></span>

  <c.Sequence>
    <c.Gate />   {{! a score's way of saying "do not start yet" }}
    <c.Parallel>
      <c.Tween @of={{array (c.role 'tile') (c.role 'blank')}}
               @x={{this.xs}} @y={{this.ys}}
               @duration={{SPAN}} @ease='linear' />
      <c.Tween @of={{c.role 'game'}} @opacity={{this.fadeGame}}
               @duration={{SPAN}} @ease='linear' />
    </c.Parallel>
  </c.Sequence>
</Choreo>

// One array per property, one entry per stop. A property function is handed
// the sprite, so each tile answers with its own journey.
xs = (sprite) => seats.get(sprite.id).map((s) => s.x);
fadeGame = [0, 0, 0, 0, 0, 1];

// Nothing here is @tracked. A render inside a region is a PASS, so tracked
// state written from a pointermove would recompile the score sixty times a
// second — the run is held in a plain field and driven imperatively.
move = (event) => {
  this.p = detent(this.at(event.clientX));   // sticky near a stop, never snapped
  this.draw();
};

// one place writes the clock, whatever moved the playhead: a drag, a spring
// after a throw, or an eased ride from a tap or an arrow key
private draw() {
  const run = this.run;
  if (!run) return;
  if (run.parked) run.advance();             // open the head gate, once
  run.pause();
  // parked a hair short: a run that reaches its own duration is FINISHED,
  // and a finished run replays itself on any later render
  run.time = (this.p / LAST) * Math.max(0, run.duration - 0.001);
}`,
    notes: RackNotes,
    slowmo: false,
    title: 'Rack',
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
    Example: Jump,
    apis: ['c.Scroll', '@align', 'c.Raise', 'c.Hold @fill', '@debug'],
    group: 'Choreo',
    id: 'jump',
    lede: 'Nine tests are red in a run of sixty. Find each one without losing your place.',
    sample: `// A jump is only information when you did not already know where you were
// going. This stage used to hand you four buttons reading "take 11" over a
// list of numbered rows — you named the row, and the scroll then told you
// where the row you had just named was. Nothing was learned.
//
// A failing test is the case where you genuinely do not know: not where it
// is, not how far apart they are, not whether they cluster. Each of the
// three steps then has a job that survives being frozen.
<c.Sequence @name={{concat 'ask-' this.pass}}>
  {{! how far down the run it is, and whether it sits with the others.
      Teleport instead and you get the row with none of the geography.
      It yields to the wheel, which here is a requirement and not a
      nicety: you are already scrolling to read an assertion. }}
  <c.Scroll @of={{c.id this.target}} @align={{this.align}} @duration={{0.5}} />

  <c.Parallel>
    {{! the only way the row can be above the sticky header AND outside
        the pane's overflow clip at once — z-index cannot buy that, since
        a stacking context does not escape an ancestor's clip. Raising
        DURING the scroll would pin it where the lift began. }}
    <c.Raise @of={{c.id this.target}} @shadow={{true}} @duration={{0.9}} />

    {{! @fill is a flash versus a record. Keeping the marks is how you
        find your place after scrolling off to read a stack trace — and
        the fill bridges the flight to the render that commits the row's
        own class, so it does not blink between the two. }}
    <c.Hold @of={{c.id this.target}} @backgroundColor='var(--ember)'
      @duration={{0.7}} @fill={{this.keep}} />
  </c.Parallel>
</c.Sequence>

// The ask number is in @name because a region declines a pass whose tree
// fingerprints identical to the one standing — and pressing "next failure"
// twice on the same row is a thing people do.`,
    slowmo: true,
    title: 'Triage',
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
    Example: LongTake,
    apis: ['c.Frame', 'c.Aim', 'c.Pan', 'c.SlowZoom', 'c.Camera3D'],
    group: '3D',
    id: 'long-take',
    lede: 'Nothing on this screen changes. Every frame of it is the camera.',
    notes: LongTakeNotes,
    sample: `{{! FIVE CONSTRUCTS, and between them every move a camera can make
    over something that is not moving. Note what is NOT here: no c.Move, no
    changeset, no c.Perform. The drawing is inert. }}
<c.Sequence>
  {{#each SHOTS as |shot|}}
    {{! arrive — the shot that changes magnification. @padding is the
        FRACTION of the frame the station should fill, not pixels: it is
        multiplied into the fitted zoom, so 0 is a camera zoomed to
        nothing rather than a tight crop. }}
    <c.Frame @of={{c.id shot.at}} @padding={{shot.fill}} @duration={{shot.move}} />
    {{! ...or travel, with the zoom HELD. The move you cannot fake with a
        zoom: attention goes somewhere, scale does not. }}
    <c.Aim @of={{c.id shot.at}} @duration={{shot.move}} />
    {{! ...or drift, by exact pixels from wherever we stand }}
    <c.Pan @x={{shot.x}} @y={{shot.y}} @duration={{shot.move}} />

    {{! A HOLD IS NOT A FREEZE. The slow push is what keeps a held shot
        alive, and it is one step rather than a second track to keep in
        step with the first. }}
    <c.SlowZoom @by={{shot.push}} @duration={{shot.hold}} />
  {{/each}}
</c.Sequence>

// and OUTSIDE, a second camera on the same list — its leg for a shot is
// that shot's own move + hold, so neither region owns the timing and
// neither can drift.
<c.Camera3D @yaw={{shot.yaw}} @pitch={{shot.pitch}} @dolly={{shot.dolly}}
  @duration={{legFor shot}} />`,
    slowmo: false,
    title: 'Long Take',
  },
  {
    Example: SagradaStage,
    apis: ['<Film>', "@seek='exact'", '@clock', 'c.Camera3D'],
    group: 'Film',
    id: 'sagrada',
    lede: 'A hundred and forty-four years of a basilica, composited live in the browser and cut by a score — with a clock in years on the rail, and a picture that is a pure function of it.',
    notes: SagradaNotes,
    route: 'sagrada',
    sample: `{{! THE FILM IS A CONSTRUCT. The shot list is data and <Film> is
    the editor that plays it: one camera step for the whole picture, one
    cue per beat, and the type, the grade, the seams, the narration and
    the mix all hung off the same clock. What the film supplies is the
    script and a picture to point at. }}
<Film @seek='exact' @clock={{this.clock}} @over='everything'>
  <:picture as |register|>
    <IframePicture @register={{register}}
      @src={{this.src}} @assets={{this.assets}} @standing={{T_TODAY}} />
  </:picture>
  <:default as |f|>
    <f.Spine @join='dip'>…the score: chapters, shots, joins…</f.Spine>
  </:default>
  <:gate as |f|>…the door, in the film's own type…</:gate>
  <:end as |f|>…the back matter…</:end>
</Film>

// ONE BEAT IS ONE SHOT, and every field is a FACT about the shot rather
// than a keyframe — which is what lets an agent direct the film by
// editing a table, and a person direct it by dragging one number.
{ id: 'gaudi', ch: 2, mode: 'plate', ticks: 8,
  cam:   { dolly: 0.86, lookY: 14, pitch: 6, yaw: 214 },
  toCam: { dolly: 0.92, lookY: 18, pitch: 9, yaw: 226 },
  join: 'dip', grade: 'ash', lut: 'plate',
  vo: 'On the seventh of June 1926, Gaudí is hit by a tram.' }

// @seek='exact' takes the spring out of the lens and makes the whole
// film a pure function of one number: scrub anywhere and the frame is
// correct, because every beat asserts its complete state and inherits
// nothing. A seek that lands inside a seam re-makes the outgoing frame
// first, so the dissolve plays from its middle exactly as it would have
// played into it.
run.time = t;              // the score
plate.time = t - beatStart(i);  // and the type, on the same clock`,
    slowmo: false,
    theater: true,
    walkthrough: [
      {
        label: 'The shot list — one entry',
        note: `The same table Towers uses, written in years. Every field is a fact about the shot; the build clock is authored through the film's own year-to-seconds map, so the number on screen and the state of the stone can never disagree.`,
        source: `{
  id: 'gaudi',
  ch: 2,
  ticks: 8,
  mode: 'plate',
  join: 'dip',               // the architect dies: the seam goes to black
  grade: 'ash',
  lut: 'plate',
  cam:   { dolly: 0.86, lookY: 14, pitch: 6, yaw: 214 },
  toCam: { dolly: 0.92, lookY: 18, pitch: 9, yaw: 226 },
  build: tAt(1926),          // where the stone stands, in film time
  stamp: { at: 0.03, y: 1926 },   // the year, enormous, in the scene
  vo: 'On the seventh of June 1926, Gaudí is hit by a tram.',
}`,
      },
      {
        label: 'The clock, in years',
        note: `Hand the construct one of these and the rail under the picture stops being a progress bar and becomes a date rule: the head rides it, the chapters are doors on it, and the readout says the year rather than the minute. Towers has no clock, so its rail is time.`,
        source: `const CLOCK = {
  span: [1882, 2034],
  tAt:    (year) => …,   // the film's unit  →  page seconds
  yearAt: (t)    => …,   // and back, for the readout on the rail
};`,
      },
      {
        label: 'The record the script is held to',
        note: `Dates follow the published history, and the film says so out loud when it runs past it: the record ends at the centenary and what follows is the plan. This is the table the beats are authored against.`,
        source: `const RECORD = [
  { year: 1882,      what: 'Cripta',            en: 'CRYPT' },
  { year: 1883,      what: 'Gaudí pren l’obra', en: 'GAUDÍ TAKES OVER' },
  { year: 1926,      what: 'Mor Gaudí',         en: 'GAUDÍ DIES' },
  { year: 1936,      what: 'Guerra Civil',      en: 'WORKS HALTED' },
  { year: [1954, 76], what: 'Façana de la Passió', en: 'PASSION FAÇADE' },
  { year: 2021,      what: 'L’estel s’encén',  en: 'THE STAR OF MARY LIT' },
  { year: 2026,      what: 'Centenari de Gaudí', en: 'CENTENARY MASS' },
];`,
      },
    ],
    title: 'Sagrada Família',
  },
  {
    Example: Grip,
    apis: [
      'createDragControls',
      'dragControls',
      'dragListener',
      'onPanSessionStart',
      'dragSnapToOrigin',
    ],
    group: 'Drag',
    id: 'grip',
    lede: 'Seat twelve people. Drag them by the corner, because the card is also a form.',
    sample: `// drag=true swallows the element's pointer whole, and a guest card has a
// note field in it and a phone number under that. dragListener=false hands the
// pointer back — a caret goes in the field, the number selects — and the corner
// tab is then the ONLY thing that can lift the card. That is not a nicety; it
// is the only arrangement in which a draggable thing can also be a form.
const controls = createDragControls();

<button {{on 'pointerdown' (fn this.lift guest.id)}}>⠿</button>

<article {{motion
  drag=true
  dragControls=(this.controlsFor guest.id)
  dragListener=false          {{! the card's own listener, off }}
  dragSnapToOrigin=true       {{! and this is the REFUSAL — see below }}
  dragTransition=RETURN
  onPanSessionStart=this.session
  onDragEnd=(fn this.drop guest)
  onTap=(fn this.press guest)
  onTapCancel=this.pressCancel
}}>…</article>

// onPanSessionStart fires at pointerdown, BEFORE the threshold that decides
// this is a drag — so every table with a chair free lights the instant you take
// hold of somebody, while you are still deciding whether to move them. Nothing
// else in the drag surface fires that early.
session = () => { this.armed = true; };

// And dragSnapToOrigin is the only "no" this interface gives. Land on a full
// table, or on nothing, and the guest flies back to the list; land on a free
// one and they take a chair. Freeze the frames and a refused drop and an
// untouched card are the same picture — the flight IS the answer.`,
    slowmo: false,
    title: 'Table Plan',
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
    Example: Drift,
    apis: ['c.inserted', 'c.moved', 'c.removed', 'c.beacon', 'c.still'],
    group: 'Choreo',
    id: 'drift',
    lede: 'A car you tune while you are driving it.',
    sample: `// Two halves, and the point of the stage is which is which.
//
// The DRIVING is not a score. Motion's springs are scalar interpolators
// toward a target — right for the wheel returning to centre, the chassis
// lagging the nose and the camera settling, and wrong for the part that
// makes it a drift game. Lateral slide is a velocity decomposition with a
// friction coefficient on the sideways half, so lib/drift.ts integrates it
// by hand. The order of these three lines IS the model: recompose in the
// frame the car was pointing in, and turn the heading only afterwards.
// Turn first and the velocity rotates with the nose every frame, for free,
// and the car can never slide at all.
vf += throttle * power * dt;              // the engine, along the nose
vr *= Math.exp(-(sliding ? bite * 0.16 : bite) * dt);   // grip, not a spring
car.vx = fx * vf + rx * vr;               // recompose in the OLD frame...
car.vy = fy * vf + ry * vr;
car.heading += car.steer * TURN * bite * dt;            // ...then turn

// The LAP BOARD is a score, and this is the whole of it. One tracked write
// per lap; nothing below is told where to go. The region reads the change
// out of the DOM — an entry appeared, the rows under it moved because it
// pushed them, and the slowest lap left because the board holds five.
<c.Parallel>
  <c.Move @of={{c.inserted 'lap'}} @from={{c.beacon 'clock'}}
    @spring={{ARRIVE}} @size={{false}} />

  {{! a different spring, because being shoved down is not arriving }}
  <c.Move @of={{c.moved 'lap'}} @spring={{SHUFFLE}} @size={{false}} />

  {{! pushed off the bottom: claimed by nobody, so it needs a place }}
  <c.Move @of={{c.removed 'lap'}} @to={{c.beacon 'bin'}} @spring={{DROP}} />

  {{! and a lap that beat nothing moves one row. Dimming the rest is what
      makes that legible — frozen, you cannot tell the list reordered. }}
  <c.Hold @of={{c.still 'lap'}} @opacity={{0.42}} @duration={{0.5}} />
</c.Parallel>`,
    slowmo: false,
    title: 'Drift',
  },
  {
    Example: Hang,
    apis: ['c.gesture', 'c.beacon', 'c.Follow', 'c.moved', 'c.still'],
    group: 'Choreo',
    id: 'hang',
    lede: 'Shuffleboard. The puck goes as far as you flick it, and no further.',
    sample: `// The shooting area is walled — dragConstraints, not a foul line — so the
// puck cannot be carried to where you want it and the distance has to come
// out of the THROW. A wall teaches the same lesson as a rule and never tells
// anyone off for crossing it.
//
// dragMomentum=false on purpose. Motion's inertia would slide the puck for
// free and prove nothing: inertia has no destination and no rules. Here the
// throw is READ, a resting place is RESOLVED from it, and only then is the
// flight AUTHORED to that place with the throw's own speed borrowed as its
// opening velocity. And COAST is not a free parameter — an overdamped spring
// decays over damping/stiffness, so the projection has to use the spring's
// own time constant or the puck visibly lies about how hard you threw it.
const SLIDE = { damping: 28, stiffness: 100 };
const COAST = SLIDE.damping / SLIDE.stiffness;

<c.Parallel>
  <c.Move @of={{c.received 'puck'}} @from={{c.gesture}} @spring={{SLIDE}}
    @size={{false}} @swap='none' />

  {{! the knock. Nothing told these to move — the collision sweep changed
      their seats and the changeset noticed. A different spring, because a
      transferred shove is not a throw. }}
  <c.Move @of={{c.moved 'puck'}} @spring={{KNOCK}} @size={{false}} />

  {{! what the throw did NOT disturb, so a chain reaction reads as one }}
  <c.Hold @of={{c.still 'puck'}} @opacity={{0.38}} @duration={{0.55}} />

  {{! shoved off the end: claimed by nobody, so it has nowhere to land }}
  <c.Move @of={{c.removed 'puck'}} @to={{c.beacon 'gutter'}} @spring={{OFF}} />

  {{! the lead line. Which puck is furthest can change PART WAY THROUGH the
      flight — the thrown one, one it knocked forward, or the old leader —
      at a moment no keyframe can name. @read takes the max every frame, so
      the line changes allegiance exactly when the lead changes hands. }}
  <c.Follow @of={{c.id 'lead'}} @to={{c.kept 'puck'}}
    @read={{lead}} @rest={{LEAD_REST}} @duration={{1.6}} />
</c.Parallel>

// And the aim preview is deliberately NOT in the score. It runs on every
// pointer move while nothing is animating, so putting it through the
// renderer would re-measure every sprite in the region sixty times a second
// to move one dashed ring. It previews info.velocity.x through the same
// projection onDragEnd will use, so the ghost is not an approximation of the
// throw — it is the throw, asked early.
aim = (event, info) => {
  const x = this.project(event.clientX, info.velocity.x, rect);
  ghost.style.setProperty('--at', String(clamp01(x)));
  ghost.textContent = callIt(x);
};`,
    slowmo: true,
    title: 'Hang',
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
    Example: Fold,
    apis: ['c.Perform', '@onPerform', '@onPerformReset', 'run.time'],
    group: 'Timeline',
    id: 'fold',
    lede: 'Scrub back through orders the timeline does not own.',
    sample: `// A COMMAND is not an animation. It is a statement of state the score
// hands to the app, and the app is what changes. The law is one line:
// the set of commands at or before the clock IS the commanded state.
<c.Sequence>
  {{#each SCHEDULE as |cmd|}}
    <c.Perform @action={{cmd.action}} @target={{cmd.target}}
      @payload={{cmd.payload}} />
    <c.Wait @duration={{cmd.hold}} />
  {{/each}}
</c.Sequence>

// The host owns the state; the region only tells it what was ordered.
<Choreo @onPerform={{this.dispatch}} @onPerformReset={{this.reset}} as |c|>

dispatch = (command) => {
  switch (command.action) {
    case 'gas.set':     this.state.gas = Number(command.payload); break;
    case 'soak.start':  this.state.soak = true;  break;  // LATCHES
    case 'cone.drop':   this.state.cone = true;  break;  // LATCHES
  }
};

// A seek BACKWARDS lands here first, and Choreo replays the remaining
// prefix after it. So a scrub is a re-derivation, not an undo — and the
// difference between a correct host and a broken one is this method.
reset = () => { this.state = { ...COLD }; };

// Refuse to do that work and the replay lands on stale state. The absolute
// settings overwrite themselves and look fine; \`soak\` and \`cone\` stay
// latched from a future that no longer exists. That is the No-reset toggle.

// The host's state is NOT tracked. onPerform fires DURING the region's
// pass; a tracked write there re-renders the region, replays the pass, and
// cancels the run that was dispatching. The chamber is painted by hand
// from custom properties instead — Build Order's discipline.
el.style.setProperty('--kf-gas', String(s.gas));`,
    notes: FoldNotes,
    slowmo: false,
    title: 'Fold',
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
