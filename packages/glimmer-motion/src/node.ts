/**
 * MotionNode — the lifecycle glue React's `motion` component provides, for one element, with no host
 * framework in it: construct the VisualElement in document order, mount post-order after the render pass,
 * update on every later pass, tear down. `{{motion}}` (motion.ts) is the ember-modifier shell around it;
 * another host wraps it the same way. Same props as the React API:
 *   initial · animate · exit · variants · transition · layout · layoutId · drag… · style · custom
 * plus `presence` (from <Presence>) instead of React context.
 */
import type {
  IProjectionNode,
  MotionNodeOptions,
  MotionValue,
  PresenceContextProps,
  VisualElement,
} from 'motion-dom';
import {
  frame,
  HTMLProjectionNode,
  HTMLVisualElement,
  isAnimationControls,
  isControllingVariants,
  isMotionValue,
  isSVGElement,
  isVariantLabel,
  isVariantNode,
  resolveMotionValue,
  resolveVariantFromProps,
  scrapeHTMLMotionValuesFromProps,
  scrapeSVGMotionValuesFromProps,
  SVGVisualElement,
  visualElementStore,
} from 'motion-dom';

import { registerBusyProbe } from './activity.ts';
import { type ChoreoHost, closestChoreo } from './choreo/registry.ts';
import type { ChoreoNode } from './choreo/types.ts';
import { initFeatures } from './features.ts';
import {
  afterSettle,
  hasTakenAnySnapshot,
  registerProjection,
  requestSettle,
  setMountFlusher,
} from './layout.ts';
import { closestLayoutGroup } from './layout-group.gts';
import {
  closestMotionConfig,
  type MotionConfigContext,
} from './motion-config.gts';
import type { PopMeasurable, PresenceHandle } from './presence-types.ts';
import { postRender } from './scheduler.ts';
import { motionSpeed, onMotionSpeed, slowed } from './speed.ts';
import { styleValue } from './unitless.ts';

/** motion-dom's own `defaultLayoutTransition`, which it does not export */
const DEFAULT_LAYOUT_TRANSITION = {
  duration: 0.45,
  ease: [0.4, 0, 0.1, 1],
} as const;

/** React's HTMLMotionProps = MotionNodeOptions + style (static values and MotionValues) */
export type MotionProps = Omit<MotionNodeOptions, 'dragConstraints'> & {
  /** internal Framer props: route the drag gesture straight into these values */
  _dragX?: MotionValue<number>;
  _dragY?: MotionValue<number>;
  /** React accepts a ref object; Glimmer has the element itself, so either is fine */
  dragConstraints?: MotionNodeOptions['dragConstraints'] | Element | null;
  /** choreography: identity across renders, and the group a <Choreo> step selects by */
  id?: string;
  /**
   * How Choreo measures this element for a shape-matched flight.
   * `'box'` (default) is the layout border box — right for plates, cards,
   * stages. `'content'` is the shrink-wrap (the ink): a full-bleed title
   * still matches as a word. Written as `data-choreo-pack`; an explicit
   * `[data-choreo-substance]` descendant still wins.
   */
  pack?: 'box' | 'content';
  presence?: PresenceHandle;
  role?: string;
  style?: Record<string, unknown>;
  /** MotionConfig's transformPagePoint — passed per element here (React merges the config into props) */
  transformPagePoint?: (p: { x: number; y: number }) => {
    x: number;
    y: number;
  };
};

/** motion.div … motion.circle: any element with an inline style */
export type MotionEl = HTMLElement | SVGElement;

/** the variant labels a motion element passes down — React's MotionContext { initial, animate } */
type TreeVariants = {
  animate?: string | string[];
  initial?: false | string | string[];
};
const treeVariants = new WeakMap<VisualElement, TreeVariants>();
/** the presence a motion element lives under — React's PresenceContext, inherited by descendants */
const presenceOf = new WeakMap<VisualElement, PresenceHandle>();
/** back-reference so a parent can refresh its descendants when the context it provides changes */
const nodeOf = new WeakMap<VisualElement, MotionNode>();
const sameTree = (a?: TreeVariants, b?: TreeVariants) =>
  a?.initial === b?.initial && a?.animate === b?.animate;

function currentTreeVariants(
  props: MotionNodeOptions,
  context: TreeVariants,
): TreeVariants {
  if (isControllingVariants(props)) {
    const { initial, animate } = props as any;
    return {
      initial:
        initial === false || isVariantLabel(initial) ? initial : undefined,
      animate: isVariantLabel(animate) ? animate : undefined,
    };
  }
  return props.inherit !== false ? context : {};
}

function makeLatestValues(
  props: MotionNodeOptions,
  parent: VisualElement | undefined,
  blockInitial: boolean,
  svg = false,
) {
  const values: Record<string, any> = {};
  // motion values handed in through style seed the latest values (React: scrapeMotionValuesFromProps)
  const motionValues = (
    svg ? scrapeSVGMotionValuesFromProps : scrapeHTMLMotionValuesFromProps
  )(props as any, {}, undefined as any);
  for (const key in motionValues) {
    values[key] = resolveMotionValue(motionValues[key]);
  }
  let { initial, animate } = props as any;
  const controlling = isControllingVariants(props);
  const variantNode = isVariantNode(props);
  const context = (parent && treeVariants.get(parent)) ?? {};
  if (parent && variantNode && !controlling && props.inherit !== false) {
    if (initial === undefined) {
      initial = context.initial;
    }
    if (animate === undefined) {
      animate = context.animate;
    }
  }
  const blocked = blockInitial || initial === false;
  const variantToSet = blocked ? animate : initial;
  if (
    variantToSet &&
    typeof variantToSet !== 'boolean' &&
    !isAnimationControls(variantToSet)
  ) {
    const list = Array.isArray(variantToSet) ? variantToSet : [variantToSet];
    for (const v of list) {
      const resolved = resolveVariantFromProps(props, v);
      if (!resolved) {
        continue;
      }
      const {
        transitionEnd,
        transition: _transition,
        ...target
      } = resolved as any;
      for (const key in target) {
        let t = target[key];
        if (Array.isArray(t)) {
          t = t[blocked ? t.length - 1 : 0];
        }
        if (t !== null) {
          values[key] = t;
        }
      }
      for (const key in transitionEnd) {
        values[key] = transitionEnd[key];
      }
    }
  }
  return values;
}

/**
 * Tell the browser which axes the page may still scroll on.
 *
 * A touch that lands on a draggable element is claimed by the page's own
 * scrolling unless the element says otherwise: the gesture sees the pointerdown
 * and then nothing, because the browser has taken the moves for a scroll. So
 * `drag` implies `touch-action`, and a single-axis drag leaves the OTHER axis
 * to the page — which is what lets a horizontal carousel live inside a page you
 * can still flick up and down. React's `useHTMLProps` writes the same value
 * into the element's style; this writes it to the element for the same reason.
 */
const CLAIMED = 'data-gm-touch-action';

function touchAction(element: MotionEl, drag: MotionNodeOptions['drag']) {
  if (!drag) {
    // only ever give back what we took: an element that was never draggable
    // may be carrying a touch-action of its own
    if (element.hasAttribute(CLAIMED)) {
      element.removeAttribute(CLAIMED);
      element.style.touchAction = '';
    }
    return;
  }
  const axis = drag === true ? 'none' : drag === 'x' ? 'pan-y' : 'pan-x';
  if (element.style.touchAction !== axis) {
    element.style.touchAction = axis;
  }
  if (!element.hasAttribute(CLAIMED)) {
    element.setAttribute(CLAIMED, '');
  }
}

function closestVisualElement(el: MotionEl): VisualElement | undefined {
  let p = el.parentElement;
  while (p) {
    const ve = visualElementStore.get(p);
    if (ve) {
      return ve;
    }
    p = p.parentElement;
  }
  return undefined;
}

function closestProjection(
  ve: VisualElement | undefined,
): IProjectionNode | undefined {
  if (!ve) {
    return undefined;
  }
  return (ve.options as any).allowProjection !== false
    ? ve.projection
    : closestProjection(ve.parent);
}

/**
 * popLayout leavers, measured but not yet lifted.
 *
 * Applying `position:absolute` to one leaver takes it out of flow, which
 * reflows every sibling after it. A second leaver measured after that reads its
 * already-shifted box and pins itself there — so popping three crumbs at once
 * used to collapse them all onto the first one's seat. Measure them all against
 * the original layout, THEN lift them, so each keeps its own place.
 *
 * The flush is a microtask, which always runs before paint; anything that reads
 * layout in the meantime forces it first.
 */
const pendingPops: { apply: () => void }[] = [];
let popFlushBooked = false;

/** where a popLayout leaver is sitting, and the box it has to be pinned inside */
interface PopSeat {
  h: number;
  isRTL: boolean;
  left: number;
  parentHeight: number;
  parentWidth: number;
  top: number;
  w: number;
}

function seatOf(el: MotionEl): PopSeat | undefined {
  const parent = (el as HTMLElement).offsetParent as HTMLElement | null;
  const cs = getComputedStyle(el);
  const w = parseFloat(cs.width),
    h = parseFloat(cs.height);
  if (!w || !h) {
    return undefined;
  }
  return {
    h,
    isRTL: cs.direction === 'rtl',
    left: (el as HTMLElement).offsetLeft,
    parentHeight: parent?.offsetHeight ?? 0,
    parentWidth: parent?.offsetWidth ?? 0,
    top: (el as HTMLElement).offsetTop,
    w,
  };
}

export function flushPendingPops() {
  if (!pendingPops.length) {
    return;
  }
  popFlushBooked = false;
  for (const { apply } of pendingPops.splice(0)) {
    apply();
  }
}

/**
 * Glimmer installs modifiers children-first, so a child cannot find its parent's
 * VisualElement when its modifier first runs. React mounts motion elements in
 * effects after commit, parents first — so do we: first runs queue here and the
 * queue mounts in document order after render.
 */
const pendingMounts = new Set<MotionNode>();
/** mount everything rendered this pass — idempotent; presence notifications call it first so that a
 *  leaver is refreshed only after its replacement has joined the shared-element stack (React: same commit) */
export function flushPendingMounts() {
  // a leaver that has been measured but not yet lifted is still in flow, and
  // would be measured as though it were staying
  flushPendingPops();
  if (!pendingMounts.size) {
    return;
  }
  const list = [...pendingMounts].sort((a, b) =>
    a.element!.compareDocumentPosition(b.element!) &
    Node.DOCUMENT_POSITION_FOLLOWING
      ? -1
      : 1,
  );
  pendingMounts.clear();
  // React: VisualElements are constructed during render, parents first — a child made while its parent is
  // still unmounted is orchestrated by that parent (manuallyAnimateOnMount = false)…
  for (const m of list) {
    m.create();
  }
  // …and effects run post-order: children before their parent, siblings in document order
  // (sibling order is what the engine's stagger index for late-mounting children is built from)
  const stack: MotionNode[] = [];
  for (const m of list) {
    while (
      stack.length &&
      !stack[stack.length - 1]!.element!.contains(m.element!)
    ) {
      stack.pop()!.mountNow();
    }
    stack.push(m);
  }
  while (stack.length) {
    stack.pop()!.mountNow();
  }
}
setMountFlusher(flushPendingMounts);

/** elements rendered this pass that have not been constructed or lifted yet */
registerBusyProbe(() =>
  pendingMounts.size
    ? `${pendingMounts.size} motion element(s) waiting to mount`
    : pendingPops.length
      ? `${pendingPops.length} popLayout leaver(s) waiting to be lifted`
      : false,
);

/** a short, recognisable name for an element in a timeout message */
function describe(el: Element | undefined): string {
  if (!el) {
    return '<detached>';
  }
  const cls = typeof el.className === 'string' ? el.className.trim() : '';
  return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${
    cls ? `.${cls.split(/\s+/).join('.')}` : ''
  }`;
}

let layoutPresenceId = 0;

export class MotionNode implements ChoreoNode, PopMeasurable {
  private ve?: HTMLVisualElement;
  private destroyed = false;
  /** this node's registration with its presence child (MeasureLayout registers per node) */
  private readonly layoutPresenceKey = `layout:${layoutPresenceId++}`;
  element?: MotionEl;
  private latest?: { ownPresence?: PresenceHandle; props: MotionNodeOptions };
  private lastPresent?: boolean;
  private config: MotionConfigContext = {};

  /** React: configAndProps = { ...MotionConfigContext, ...props }. Looked up when used, not when the args
   *  arrive: modifiers install children-first, so a <MotionConfig> above has not registered yet at update time */
  private configured(props: MotionNodeOptions): MotionNodeOptions {
    const config = (this.config = this.element
      ? closestMotionConfig(this.element)
      : {});
    const defaults: Record<string, unknown> = {};
    if (config.transition !== undefined) {
      defaults['transition'] = config.transition;
    }
    if (config.transformPagePoint) {
      defaults['transformPagePoint'] = config.transformPagePoint;
    }
    const merged = { ...defaults, ...props } as MotionNodeOptions;
    // slow motion: the engine only ever sees the scaled transition, so the
    // animation is born slower rather than being sped up mid-flight
    let source = merged.transition;
    if (
      source === undefined &&
      motionSpeed() !== 1 &&
      (merged.layout !== undefined || merged.layoutId !== undefined)
    ) {
      // A layout animation resolves its own transition inside the projection
      // tree: `options.transition`, else the element's own `transition` prop,
      // else a default the engine keeps to itself. Only the middle one is ours
      // to scale, so a projecting element that never declared a transition
      // would ignore slow motion entirely. Hand it the engine's own default,
      // scaled — and only while slowed, so at normal speed the engine still
      // reaches its default by its own path and nothing changes.
      source = DEFAULT_LAYOUT_TRANSITION as never;
    }
    const scaled = slowed(source as never);
    return (
      scaled === merged.transition ? merged : { ...merged, transition: scaled }
    ) as MotionNodeOptions;
  }

  /** re-configure when the global speed changes, so the next layout animation is born slowed */
  private watchSpeed() {
    this.unsubscribeSpeed ??= onMotionSpeed(() => {
      if (this.ve && !this.destroyed && this.element && this.latest) {
        this.apply(
          this.element,
          this.configured(this.latest.props),
          this.latest.ownPresence,
        );
      }
    });
  }
  private unsubscribeSpeed?: () => void;
  private stopProbe?: () => void;
  private unregister?: () => void;
  private popStyle?: HTMLStyleElement;
  /** the seat measured before the render that removed this element */
  private popSeat?: PopSeat;
  private unregisterPop?: () => void;
  /** boxel-motion's sprite identity: a <Choreo> above selects this element by these */
  id: string | null = null;
  role: string | null = null;
  private choreo?: ChoreoHost;
  private presenceRegistered = false;

  constructor() {
    initFeatures();
  }

  /** React render: the element's props for this pass */
  update(element: MotionEl, named: MotionProps) {
    const { presence: ownPresence, id, role, pack, ...rest } = named;
    this.id = id ?? null;
    this.role = role ?? null;
    if (pack === 'content') {
      element.setAttribute('data-choreo-pack', 'content');
    } else {
      element.removeAttribute('data-choreo-pack');
    }
    const props = { ...rest } as MotionNodeOptions;
    // dragConstraints given as an element → the ref object the gesture code expects
    if (named.dragConstraints instanceof Element) {
      (props as any).dragConstraints = { current: named.dragConstraints };
    }
    this.element = element;
    touchAction(element, props.drag);
    this.latest = { props, ownPresence };
    // tracked reads: a presence flip re-runs modify even while the handle is inherited
    void ownPresence?.isPresent;
    if (!this.ve) {
      if (!pendingMounts.size) {
        postRender(flushPendingMounts);
      }
      pendingMounts.add(this);
      return;
    }
    this.apply(element, this.configured(props), ownPresence);
  }

  private unsubscribePresence?: () => void;

  /** React render: construct the VisualElement (not yet mounted) */
  create() {
    if (this.ve || this.destroyed || !this.element || !this.latest) {
      return;
    }
    const element = this.element;
    const { ownPresence } = this.latest;
    const props = this.configured(this.latest.props);
    const parent = closestVisualElement(element);
    // a direct child of <Presence> gets its handle explicitly; anything nested inherits it through the tree
    const presence =
      ownPresence ?? (parent ? presenceOf.get(parent) : undefined);
    const presenceContext = presence ? presence.context : null;
    {
      const blockInitial = presenceContext?.initial === false;
      // motion.circle etc.: the SVG visual element renders attrs (cx, r…) and CSS transforms; <svg> itself is HTML-like
      const svg = isSVGElement(element);
      const Ctor = svg ? SVGVisualElement : HTMLVisualElement;
      const renderState = svg
        ? { style: {}, transform: {}, transformOrigin: {}, vars: {}, attrs: {} }
        : { style: {}, transform: {}, transformOrigin: {}, vars: {} };
      const ve = new (Ctor as typeof HTMLVisualElement)(
        {
          visualState: {
            latestValues: makeLatestValues(props, parent, blockInitial, svg),
            renderState,
          },
          parent,
          presenceContext,
          props,
          blockInitialAnimation: blockInitial,
          // React's MotionConfigContext defaults this to "never" — Motion is a
          // library you opt into, so it assumes you meant it. On the web
          // platform the person's setting is the default and honouring it is
          // not a feature: `prefers-reduced-motion: reduce` disables transform
          // and layout animation here unless a <MotionConfig> above says
          // otherwise. Porting a React app that relied on the other default is
          // one attribute: <MotionConfig @reducedMotion="never">.
          reducedMotionConfig: this.config.reducedMotion ?? 'user',
          skipAnimations: this.config.skipAnimations,
        },
        { allowProjection: true },
      );
      this.ve = ve;
      this.stopProbe = registerBusyProbe(() => {
        const live = this.ve;
        if (!live || this.destroyed) {
          return false;
        }
        for (const [key, value] of live.values) {
          // paused by a run handle is a still, not motion (§4.6): a parked
          // gate or a held scrub must read as settled
          if (
            value.isAnimating() &&
            (value.animation as { state?: string } | undefined)?.state !==
              'paused'
          ) {
            return `${describe(this.element)} ${key}`;
          }
        }
        if (live.projection?.currentAnimation) {
          return `${describe(this.element)} layout`;
        }
        return false;
      });
      nodeOf.set(ve, this);
      visualElementStore.set(element, ve); // visible to children constructed after us, before any mount
      treeVariants.set(
        ve,
        currentTreeVariants(props, (parent && treeVariants.get(parent)) ?? {}),
      );
      if (presence) {
        presenceOf.set(ve, presence);
        this.unsubscribePresence = presence.subscribe(() => this.refresh());
      }
      // only the element the handle was passed to directly pops (React:
      // PopChild wraps the child of AnimatePresence, not its descendants)
      if (ownPresence) {
        this.unregisterPop = ownPresence.popCandidate(this);
      }
      if (props.layout || props.layoutId || props.drag) {
        // React: an element rendered through a portal does not project under its DOM-less parent
        const portalled = element.hasAttribute('data-framer-portal-id');
        const projection = new HTMLProjectionNode(
          ve.latestValues,
          portalled ? undefined : (closestProjection(parent) as any),
        ) as unknown as IProjectionNode;
        ve.projection = projection;
        // React's useLayoutId: a LayoutGroup id namespaces the layoutId; MeasureLayout adds the node to the group
        const group = closestLayoutGroup(element);
        const layoutId =
          group?.id && props.layoutId !== undefined
            ? `${group.id}-${props.layoutId}`
            : props.layoutId;
        if (group?.group) {
          group.group.add(projection as any);
          const remove = () => group.group!.remove(projection as any);
          const prev = this.unregister;
          this.unregister = () => {
            prev?.();
            remove();
          };
        }
        projection.setOptions({
          layoutId,
          layout: props.layout,
          visualElement: ve,
          animationType:
            typeof props.layout === 'string' ? props.layout : 'both',
          // createProjectionNode: draggables (and ref-constrained ones) always measure
          alwaysMeasureLayout:
            Boolean(props.drag) ||
            Boolean(
              (props as any).dragConstraints &&
              typeof (props as any).dragConstraints === 'object' &&
              'current' in (props as any).dragConstraints,
            ),
          crossfade: (props as any).layoutCrossfade,
          layoutScroll: (props as any).layoutScroll,
          layoutRoot: (props as any).layoutRoot,
          layoutAnchor: (props as any).layoutAnchor,
          layoutDependency: (props as any).layoutDependency,
          onExitComplete: () =>
            presenceContext?.onExitComplete?.(this.layoutPresenceKey),
        } as any);
        if (presenceContext?.register) {
          // MeasureLayout registers per node and unregisters on unmount. Losing
          // the release leaves a dead node registered against a Presence child
          // that will later have to wait for it to report an exit it can no
          // longer report — every leaver after that is stranded on screen.
          const release = presenceContext.register(this.layoutPresenceKey);
          this.presenceRegistered = true;
          const beforeRelease = this.unregister;
          this.unregister = () => {
            beforeRelease?.();
            release?.();
          };
        }
        const unregisterProjection = registerProjection(projection);
        const prevUnregister = this.unregister;
        this.unregister = () => {
          prevUnregister?.();
          unregisterProjection();
        };
      }
    }
  }

  /** React effect: mount → update → features → animateChanges */
  mountNow() {
    const ve = this.ve;
    if (!ve || ve.current || this.destroyed || !this.element || !this.latest) {
      return;
    }
    const element = this.element;
    const { ownPresence } = this.latest;
    const props = this.configured(this.latest.props);
    const presence = ownPresence ?? presenceOf.get(ve);
    const isPresent = presence ? presence.isPresent : true;
    const presenceContext = presence ? presence.context : null;
    {
      this.applyStyle(element, props, undefined);
      ve.mount(element as HTMLElement);
      // React renders `initial` into the style attribute synchronously; here the engine would render it in a
      // microtask — too late for the projection's first measurement (percentage transforms resolve against it)
      ve.render();
      // React always renders twice before the first animation (the tests even rely on it):
      // the second pass is what subscribes onUpdate/onAnimationStart/onAnimationComplete
      // Glimmer mounts after render, so presence may already have flipped since this element was rendered.
      // React would have mounted it present and seen the flip in a later effect — the initial animateChanges
      // suppresses animation when initial === animate, so an exit raised during it would be swallowed.
      // Mount present (through the first animateChanges), then apply the real context.
      const mountContext =
        presenceContext && !isPresent
          ? { ...presenceContext, isPresent: true }
          : presenceContext;
      ve.update(props, mountContext);
      ve.updateFeatures();
      ve.scheduleRenderMicrotask();
      if (this.id !== null || this.role !== null) {
        this.joinChoreo(element, presenceContext);
      }
      if (ve.projection) {
        // its transition is resolved inside the projection tree, from props
        // read at animation time — so a speed change has to re-configure it
        // before the interaction, not during
        this.watchSpeed();
        if (hasTakenAnySnapshot) {
          requestSettle();
        }
        ve.projection.addEventListener('animationComplete', () =>
          presenceContext?.onExitComplete?.(this.layoutPresenceKey),
        );
      }
      // React: useEffect right after commit — synchronous here, the DOM is already in place
      ve.animationState?.animateChanges();
      ve.enteringChildren = undefined;
      if (mountContext !== presenceContext) {
        // …and now the flip that happened while we were waiting to mount
        this.lastPresent = true;
        this.apply(element, props, ownPresence);
        return;
      }
      this.lastPresent = isPresent;
    }
  }

  /** every later pass: React's update → updateFeatures → animateChanges */
  private apply(
    element: MotionEl,
    props: MotionNodeOptions,
    ownPresence?: PresenceHandle,
  ) {
    const ve = this.ve!;
    const parent = ve.parent;
    const presence =
      ownPresence ?? (parent ? presenceOf.get(parent) : undefined);
    const isPresent = presence ? presence.isPresent : true;
    // AnimatePresence renders a leaving child from the element it last had while present: its props are
    // frozen for the whole exit. A Glimmer block stays live, so freeze them here — a prop change landing in
    // the same pass as the exit would otherwise start animations over the exit's values.
    if (!isPresent && ve.current) {
      props = ve.getProps() as MotionNodeOptions;
    }
    const presenceContext = presence ? presence.context : null;
    const nextTree = currentTreeVariants(
      props,
      (parent && treeVariants.get(parent)) ?? {},
    );
    const treeChanged = !sameTree(treeVariants.get(ve), nextTree);
    treeVariants.set(ve, nextTree);
    const projection = ve.projection as IProjectionNode | undefined;
    if (projection) {
      // MeasureLayout.getSnapshotBeforeUpdate: with a layoutDependency that has not changed the node
      // does not snapshot — the render detector already did, so drop that snapshot again
      const prevDep = (ve.getProps() as any).layoutDependency;
      const nextDep = (props as any).layoutDependency;
      if (
        nextDep !== undefined &&
        prevDep === nextDep &&
        this.lastPresent === isPresent
      ) {
        projection.clearSnapshot();
      }
      projection.setOptions({
        ...projection.options,
        layoutDependency: nextDep,
        layoutAnchor: (props as any).layoutAnchor,
      });
    }
    const pops = ownPresence?.mode === 'popLayout'; // PopChild applies to the direct child only
    // React re-renders the WHOLE subtree of a presence child when it starts leaving (every consumer of
    // PresenceContext below it). Glimmer only re-runs the modifiers whose own args changed, so a descendant
    // would never learn it is exiting — and its registration would block the exit forever.
    const presenceFlipped = this.lastPresent !== isPresent;
    if (projection && this.lastPresent !== isPresent) {
      projection.isPresent = isPresent;
      if (pops) {
        this.pop(element, isPresent, ownPresence!);
      }
      if (isPresent) {
        projection.promote();
      } else if (!projection.relegate()) {
        frame.postRender(() => {
          // A shared-layout leaver is completed by the crossfade: the element
          // it hands over to owns when it goes. But a stack whose only member
          // is this leaver has nobody to hand over to and no crossfade to wait
          // for — counting it as "someone else will finish this" left the
          // registration open forever, and with it the whole <Presence> entry.
          // Filtering the gallery is where that showed: every leaving card
          // holding a lone-member stack (a layoutId inside its own demo) stayed
          // in the DOM at opacity 0, and coming back left it stuck there.
          const stack = projection.getStack();
          const others = stack?.members.filter((m) => m !== projection) ?? [];
          if (!others.length) {
            presenceContext?.onExitComplete?.(this.layoutPresenceKey);
          }
        });
      }
    } else if (!projection && pops && this.lastPresent !== isPresent) {
      this.pop(element, isPresent, ownPresence!);
    }
    this.applyStyle(element, props, ve.getProps());
    ve.update(props, presenceContext);
    ve.updateFeatures();
    ve.scheduleRenderMicrotask();
    ve.animationState?.animateChanges();
    // React's usePresence: a leaving child is safe to remove once its own exit
    // animation has finished, and motion's animateChanges() resolves exactly
    // then. A node WITH a projection is completed by the layout pass below (a
    // shared-layout leaver must outlive its own values, and the crossfade owns
    // when it goes). A node WITHOUT one has nothing else to report for it — so
    // before this it was only ever removed if some later render happened to run
    // the pass again, and a leaver nothing re-rendered stayed on screen with
    // its exit finished and its removal never asked for.
    if (projection) {
      // MeasureLayout.componentDidUpdate: once this pass has settled, a lead with nothing to animate may go
      afterSettle(() => {
        if (!(projection as any).currentAnimation && projection.isLead()) {
          presenceContext?.onExitComplete?.(this.layoutPresenceKey);
        }
      });
    }
    this.lastPresent = isPresent;
    // React: a changed MotionContext re-renders every consumer below — descendants get their update pass
    if (treeChanged || presenceFlipped) {
      ve.children.forEach((child) => nodeOf.get(child)?.refresh());
    }
  }

  /* ---- ChoreoNode: what a <Choreo> above needs from this element ---- */

  /** a participant registers with the nearest region, and with its Presence so a timeline can outlive a plain exit */
  private joinChoreo(
    element: MotionEl,
    presenceContext: PresenceContextProps | null,
  ) {
    const host = closestChoreo(element);
    if (!host) {
      return;
    }
    this.choreo = host;
    const leave = host.register(this);
    if (presenceContext?.register && !this.presenceRegistered) {
      const release = presenceContext.register(this.layoutPresenceKey);
      this.presenceRegistered = true;
      const before = this.unregister;
      this.unregister = () => {
        before?.();
        release?.();
      };
    }
    const before = this.unregister;
    this.unregister = () => {
      before?.();
      leave();
    };
  }

  get visualElement(): VisualElement | undefined {
    return this.ve;
  }

  get layoutKey(): string {
    return this.layoutPresenceKey;
  }

  /** for the region's @debug lints (§5.3) */
  get ownAnimation(): boolean {
    const props = this.latest?.props as
      { animate?: unknown; exit?: unknown; initial?: unknown } | undefined;
    return Boolean(props && (props.animate || props.exit || props.initial));
  }

  get presenceManaged(): boolean {
    return Boolean(this.latest?.ownPresence);
  }

  get isPresent(): boolean {
    const presence =
      this.latest?.ownPresence ?? (this.ve && presenceOf.get(this.ve));
    return presence ? presence.isPresent : true;
  }

  /** the choreography is done with a leaving element: tell its Presence */
  exitComplete() {
    const presence =
      this.latest?.ownPresence ?? (this.ve && presenceOf.get(this.ve));
    presence?.context.onExitComplete?.(this.layoutPresenceKey);
  }

  /** the choreography is done with an element whose unmount it deferred */
  release() {
    const ve = this.ve;
    if (!ve) {
      return;
    }
    this.ve = undefined;
    ve.unmount();
  }

  /** re-run the update pass with the latest args (a context or presence change above us) */
  refresh() {
    if (this.ve?.current && this.element && this.latest) {
      this.apply(
        this.element,
        this.configured(this.latest.props),
        this.latest.ownPresence,
      );
    }
  }

  /** the non-motion-value part of `style` goes straight onto the element, as React's style attribute would —
   *  except keys the engine already owns (it renders those itself, and decides whether a style change applies) */
  private applyStyle(
    el: MotionEl,
    props: MotionNodeOptions,
    prev: MotionNodeOptions | undefined,
  ) {
    const style = (props as any).style as Record<string, any> | undefined;
    const prevStyle = (prev as any)?.style as Record<string, any> | undefined;
    if (style === prevStyle) {
      return;
    }
    if (prevStyle) {
      for (const key in prevStyle) {
        if (!style || !(key in style)) {
          el.style.removeProperty(
            key.startsWith('--')
              ? key
              : key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()),
          );
        }
      }
    }
    if (!style) {
      return;
    }
    for (const key in style) {
      const v = style[key];
      if (isMotionValue(v) || v === undefined || v === null) {
        continue;
      }
      if (this.ve?.hasValue(key)) {
        continue;
      }
      if (key.startsWith('--')) {
        el.style.setProperty(key, String(v));
      } else if (key in el.style) {
        (el.style as any)[key] = styleValue(key, v);
      }
    }
  }

  /**
   * React's PopChildMeasure.getSnapshotBeforeUpdate: the seat this element
   * occupies, read BEFORE the render that removes it.
   *
   * <Presence> calls this from its own diff, while the arrivals for this pass
   * are still unrendered. Measuring later reads a layout that already holds
   * them — the container has grown, and a centred one has moved — so the
   * leaver would be pinned somewhere it never stood.
   */
  measureForPop() {
    const el = this.element;
    if (el?.isConnected) {
      this.popSeat = seatOf(el);
    }
  }

  /** popLayout: a leaving element is lifted out of flow at its last box so siblings can close up */
  private pop(el: MotionEl, isPresent: boolean, handle: PresenceHandle) {
    if (isPresent) {
      this.popStyle?.remove();
      this.popStyle = undefined;
      this.popSeat = undefined;
      el.removeAttribute('data-motion-pop-id');
      return;
    }
    // the pre-render measurement if <Presence> took one; otherwise this
    // element mounted already leaving, and where it is now is all there is
    const seat = this.popSeat ?? seatOf(el);
    this.popSeat = undefined;
    if (!seat) {
      return;
    }
    const { w, h, top, left, parentWidth, parentHeight, isRTL } = seat;
    const right = parentWidth - w - left,
      bottom = parentHeight - h - top;
    const x =
      handle.anchorX === 'left'
        ? isRTL
          ? `right:${right}`
          : `left:${left}`
        : isRTL
          ? `left:${left}`
          : `right:${right}`;
    const y = handle.anchorY === 'bottom' ? `bottom:${bottom}` : `top:${top}`;
    const id = `pop-${Math.random().toString(36).slice(2, 8)}`;
    el.dataset['motionPopId'] = id;
    // measured above against the layout as it stands; the lift itself waits
    // until every sibling leaving in this pass has been measured too
    pendingPops.push({
      apply: () => {
        if (this.destroyed || el.dataset['motionPopId'] !== id) {
          return;
        }
        const style = document.createElement('style');
        if (this.config.nonce) {
          style.nonce = this.config.nonce;
        }
        document.head.appendChild(style);
        style.sheet?.insertRule(
          `[data-motion-pop-id="${id}"]{position:absolute!important;width:${w}px!important;height:${h}px!important;${x}px!important;${y}px!important;}`,
        );
        this.popStyle = style;
      },
    });
    if (!popFlushBooked) {
      popFlushBooked = true;
      queueMicrotask(flushPendingPops);
    }
  }

  /** React unmount */
  destroy() {
    this.destroyed = true;
    pendingMounts.delete(this);
    this.unsubscribePresence?.();
    this.unregisterPop?.();
    this.unsubscribeSpeed?.();
    this.stopProbe?.();
    this.stopProbe = undefined;
    const ve = this.ve;
    if (!ve) {
      return;
    }
    ve.projection?.scheduleCheckAfterUnmount?.();
    this.unregister?.();
    this.popStyle?.remove();
    // a removed participant may still have a row to play: the region unmounts it when that ends
    if (this.choreo?.claim(this)) {
      return;
    }
    ve.unmount();
    this.ve = undefined;
  }
}

export default MotionNode;
