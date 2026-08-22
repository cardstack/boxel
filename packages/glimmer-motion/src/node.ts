/**
 * MotionNode — the lifecycle glue React's `motion` component provides, for one element, with no host
 * framework in it: construct the VisualElement in document order, mount post-order after the render pass,
 * update on every later pass, tear down. `{{motion}}` (motion.ts) is the ember-modifier shell around it;
 * another host wraps it the same way. Same props as the React API:
 *   initial · animate · exit · variants · transition · layout · layoutId · drag… · style · custom
 * plus `presence` (from <Presence>) instead of React context.
 */
import { HTMLVisualElement, SVGVisualElement, HTMLProjectionNode, isSVGElement, scrapeSVGMotionValuesFromProps, frame, microtask, visualElementStore, isControllingVariants, isVariantNode, isAnimationControls, isVariantLabel, isMotionValue, resolveMotionValue, resolveVariantFromProps, scrapeHTMLMotionValuesFromProps } from 'motion-dom'
import type { MotionValue, MotionNodeOptions, VisualElement, IProjectionNode } from 'motion-dom';
import { initFeatures } from './features';
import { hasTakenAnySnapshot, registerProjection, requestSettle, afterSettle, setMountFlusher } from './layout';
import { closestLayoutGroup } from './layout-group';
import { postRender } from './scheduler';
import type { PresenceHandle } from './presence-types';

/** React's HTMLMotionProps = MotionNodeOptions + style (static values and MotionValues) */
export type MotionProps = Omit<MotionNodeOptions, 'dragConstraints'> & {
  presence?: PresenceHandle;
  style?: Record<string, unknown>;
  /** React accepts a ref object; Glimmer has the element itself, so either is fine */
  dragConstraints?: MotionNodeOptions['dragConstraints'] | Element | null;
  /** MotionConfig's transformPagePoint — passed per element here (React merges the config into props) */
  transformPagePoint?: (p: { x: number; y: number }) => { x: number; y: number };
  /** internal Framer props: route the drag gesture straight into these values */
  _dragX?: MotionValue<number>;
  _dragY?: MotionValue<number>;
};

/** motion.div … motion.circle: any element with an inline style */
export type MotionEl = HTMLElement | SVGElement;

/** the variant labels a motion element passes down — React's MotionContext { initial, animate } */
type TreeVariants = { initial?: false | string | string[]; animate?: string | string[] };
const treeVariants = new WeakMap<VisualElement, TreeVariants>();
/** the presence a motion element lives under — React's PresenceContext, inherited by descendants */
const presenceOf = new WeakMap<VisualElement, PresenceHandle>();
/** back-reference so a parent can refresh its descendants when the context it provides changes */
const nodeOf = new WeakMap<VisualElement, MotionNode>();
const sameTree = (a?: TreeVariants, b?: TreeVariants) => a?.initial === b?.initial && a?.animate === b?.animate;

function currentTreeVariants(props: MotionNodeOptions, context: TreeVariants): TreeVariants {
  if (isControllingVariants(props)) {
    const { initial, animate } = props as any;
    return {
      initial: initial === false || isVariantLabel(initial) ? initial : undefined,
      animate: isVariantLabel(animate) ? animate : undefined,
    };
  }
  return props.inherit !== false ? context : {};
}

function makeLatestValues(props: MotionNodeOptions, parent: VisualElement | undefined, blockInitial: boolean, svg = false) {
  const values: Record<string, any> = {};
  // motion values handed in through style seed the latest values (React: scrapeMotionValuesFromProps)
  const motionValues = (svg ? scrapeSVGMotionValuesFromProps : scrapeHTMLMotionValuesFromProps)(props as any, {}, undefined as any);
  for (const key in motionValues) values[key] = resolveMotionValue(motionValues[key]);
  let { initial, animate } = props as any;
  const controlling = isControllingVariants(props);
  const variantNode = isVariantNode(props);
  const context = (parent && treeVariants.get(parent)) ?? {};
  if (parent && variantNode && !controlling && props.inherit !== false) {
    if (initial === undefined) initial = context.initial;
    if (animate === undefined) animate = context.animate;
  }
  const blocked = blockInitial || initial === false;
  const variantToSet = blocked ? animate : initial;
  if (variantToSet && typeof variantToSet !== 'boolean' && !isAnimationControls(variantToSet)) {
    const list = Array.isArray(variantToSet) ? variantToSet : [variantToSet];
    for (const v of list) {
      const resolved = resolveVariantFromProps(props, v);
      if (!resolved) continue;
      const { transitionEnd, transition, ...target } = resolved as any;
      for (const key in target) {
        let t = target[key];
        if (Array.isArray(t)) t = t[blocked ? t.length - 1 : 0];
        if (t !== null) values[key] = t;
      }
      for (const key in transitionEnd) values[key] = transitionEnd[key];
    }
  }
  return values;
}

function closestVisualElement(el: MotionEl): VisualElement | undefined {
  let p = el.parentElement;
  while (p) {
    const ve = visualElementStore.get(p);
    if (ve) return ve;
    p = p.parentElement;
  }
  return undefined;
}

function closestProjection(ve: VisualElement | undefined): IProjectionNode | undefined {
  if (!ve) return undefined;
  return (ve.options as any).allowProjection !== false ? ve.projection : closestProjection(ve.parent);
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
  if (!pendingMounts.size) return;
  const list = [...pendingMounts].sort((a, b) => (a.element!.compareDocumentPosition(b.element!) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  pendingMounts.clear();
  // React: VisualElements are constructed during render, parents first — a child made while its parent is
  // still unmounted is orchestrated by that parent (manuallyAnimateOnMount = false)…
  for (const m of list) m.create();
  // …and effects run post-order: children before their parent, siblings in document order
  // (sibling order is what the engine's stagger index for late-mounting children is built from)
  const stack: MotionNode[] = [];
  for (const m of list) {
    while (stack.length && !stack[stack.length - 1]!.element!.contains(m.element!)) stack.pop()!.mountNow();
    stack.push(m);
  }
  while (stack.length) stack.pop()!.mountNow();
}
setMountFlusher(flushPendingMounts);

let layoutPresenceId = 0;

export default class MotionNode {
  private ve?: HTMLVisualElement;
  private destroyed = false;
  /** this node's registration with its presence child (MeasureLayout registers per node) */
  private readonly layoutPresenceKey = `layout:${layoutPresenceId++}`;
  element?: MotionEl;
  private latest?: { props: MotionNodeOptions; ownPresence?: PresenceHandle };
  private lastPresent?: boolean;
  private unregister?: () => void;
  private popStyle?: HTMLStyleElement;

  constructor() {
    initFeatures();
  }

  /** React render: the element's props for this pass */
  update(element: MotionEl, named: MotionProps) {
    const { presence: ownPresence, ...rest } = named;
    const props = { ...rest } as MotionNodeOptions;
    // dragConstraints given as an element → the ref object the gesture code expects
    if (named.dragConstraints instanceof Element) (props as any).dragConstraints = { current: named.dragConstraints };
    this.element = element;
    this.latest = { props, ownPresence };
    // tracked reads: a presence flip re-runs modify even while the handle is inherited
    void ownPresence?.isPresent;
    if (!this.ve) {
      if (!pendingMounts.size) postRender(flushPendingMounts);
      pendingMounts.add(this);
      return;
    }
    this.apply(element, props, ownPresence);
  }

  private unsubscribePresence?: () => void;

  /** React render: construct the VisualElement (not yet mounted) */
  create() {
    if (this.ve || this.destroyed || !this.element || !this.latest) return;
    const element = this.element;
    const { props, ownPresence } = this.latest;
    const parent = closestVisualElement(element);
    // a direct child of <Presence> gets its handle explicitly; anything nested inherits it through the tree
    const presence = ownPresence ?? (parent ? presenceOf.get(parent) : undefined);
    const presenceContext = presence ? presence.context : null;
    {
      const blockInitial = presenceContext?.initial === false;
      // motion.circle etc.: the SVG visual element renders attrs (cx, r…) and CSS transforms; <svg> itself is HTML-like
      const svg = isSVGElement(element);
      const Ctor = svg ? SVGVisualElement : HTMLVisualElement;
      const renderState = svg ? { style: {}, transform: {}, transformOrigin: {}, vars: {}, attrs: {} } : { style: {}, transform: {}, transformOrigin: {}, vars: {} };
      const ve = new (Ctor as typeof HTMLVisualElement)(
        {
          visualState: { latestValues: makeLatestValues(props, parent, blockInitial, svg), renderState },
          parent,
          presenceContext,
          props,
          blockInitialAnimation: blockInitial,
          reducedMotionConfig: 'user',
        },
        { allowProjection: true },
      );
      this.ve = ve;
      nodeOf.set(ve, this);
      visualElementStore.set(element, ve); // visible to children constructed after us, before any mount
      treeVariants.set(ve, currentTreeVariants(props, (parent && treeVariants.get(parent)) ?? {}));
      if (presence) {
        presenceOf.set(ve, presence);
        this.unsubscribePresence = presence.subscribe(() => this.refresh());
      }
      if (props.layout || props.layoutId || props.drag) {
        // React: an element rendered through a portal does not project under its DOM-less parent
        const portalled = element.hasAttribute('data-framer-portal-id');
        const projection = new HTMLProjectionNode(ve.latestValues, portalled ? undefined : (closestProjection(parent) as any)) as unknown as IProjectionNode;
        ve.projection = projection;
        // React's useLayoutId: a LayoutGroup id namespaces the layoutId; MeasureLayout adds the node to the group
        const group = closestLayoutGroup(element);
        const layoutId = group?.id && props.layoutId !== undefined ? `${group.id}-${props.layoutId}` : props.layoutId;
        if (group?.group) {
          group.group.add(projection as any);
          const remove = () => group.group!.remove(projection as any);
          const prev = this.unregister;
          this.unregister = () => { prev?.(); remove(); };
        }
        projection.setOptions({
          layoutId,
          layout: props.layout,
          visualElement: ve,
          animationType: typeof props.layout === 'string' ? props.layout : 'both',
          // createProjectionNode: draggables (and ref-constrained ones) always measure
          alwaysMeasureLayout: Boolean(props.drag) || Boolean((props as any).dragConstraints && typeof (props as any).dragConstraints === 'object' && 'current' in (props as any).dragConstraints),
          crossfade: (props as any).layoutCrossfade,
          layoutScroll: (props as any).layoutScroll,
          layoutRoot: (props as any).layoutRoot,
          layoutAnchor: (props as any).layoutAnchor,
          layoutDependency: (props as any).layoutDependency,
          onExitComplete: () => presenceContext?.onExitComplete?.(this.layoutPresenceKey),
        } as any);
        if (presenceContext?.register) presenceContext.register(this.layoutPresenceKey);
        const unregisterProjection = registerProjection(projection);
        const prevUnregister = this.unregister;
        this.unregister = () => { prevUnregister?.(); unregisterProjection(); };
      }
    }
  }

  /** React effect: mount → update → features → animateChanges */
  mountNow() {
    const ve = this.ve;
    if (!ve || ve.current || this.destroyed || !this.element || !this.latest) return;
    const element = this.element;
    const { props, ownPresence } = this.latest;
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
      const mountContext = presenceContext && !isPresent ? { ...presenceContext, isPresent: true } : presenceContext;
      ve.update(props, mountContext);
      ve.updateFeatures();
      ve.scheduleRenderMicrotask();
      if (ve.projection) {
        if (hasTakenAnySnapshot) requestSettle();
        ve.projection.addEventListener('animationComplete', () => presenceContext?.onExitComplete?.(this.layoutPresenceKey));
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
  private apply(element: MotionEl, props: MotionNodeOptions, ownPresence?: PresenceHandle) {
    const ve = this.ve!;
    const parent = ve.parent;
    const presence = ownPresence ?? (parent ? presenceOf.get(parent) : undefined);
    const isPresent = presence ? presence.isPresent : true;
    // AnimatePresence renders a leaving child from the element it last had while present: its props are
    // frozen for the whole exit. A Glimmer block stays live, so freeze them here — a prop change landing in
    // the same pass as the exit would otherwise start animations over the exit's values.
    if (!isPresent && ve.current) props = ve.getProps() as MotionNodeOptions;
    const presenceContext = presence ? presence.context : null;
    const nextTree = currentTreeVariants(props, (parent && treeVariants.get(parent)) ?? {});
    const treeChanged = !sameTree(treeVariants.get(ve), nextTree);
    treeVariants.set(ve, nextTree);
    const projection = ve.projection as IProjectionNode | undefined;
    if (projection) {
      // MeasureLayout.getSnapshotBeforeUpdate: with a layoutDependency that has not changed the node
      // does not snapshot — the render detector already did, so drop that snapshot again
      const prevDep = (ve.getProps() as any).layoutDependency;
      const nextDep = (props as any).layoutDependency;
      if (nextDep !== undefined && prevDep === nextDep && this.lastPresent === isPresent) projection.clearSnapshot();
      projection.setOptions({ ...projection.options, layoutDependency: nextDep, layoutAnchor: (props as any).layoutAnchor });
    }
    const pops = ownPresence?.mode === 'popLayout'; // PopChild applies to the direct child only
    if (projection && this.lastPresent !== isPresent) {
      projection.isPresent = isPresent;
      if (pops) this.pop(element, isPresent, ownPresence!);
      if (isPresent) projection.promote();
      else if (!projection.relegate()) {
        frame.postRender(() => {
          const stack = projection.getStack();
          if (!stack || !stack.members.length) presenceContext?.onExitComplete?.(this.layoutPresenceKey);
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
    if (projection) {
      // MeasureLayout.componentDidUpdate: once this pass has settled, a lead with nothing to animate may go
      afterSettle(() => {
        if (!(projection as any).currentAnimation && projection.isLead()) presenceContext?.onExitComplete?.(this.layoutPresenceKey);
      });
    }
    this.lastPresent = isPresent;
    // React: a changed MotionContext re-renders every consumer below — descendants get their update pass
    if (treeChanged) ve.children.forEach((child) => nodeOf.get(child)?.refresh());
  }

  /** re-run the update pass with the latest args (a context or presence change above us) */
  refresh() {
    if (this.ve?.current && this.element && this.latest) this.apply(this.element, this.latest.props, this.latest.ownPresence);
  }

  /** the non-motion-value part of `style` goes straight onto the element, as React's style attribute would —
   *  except keys the engine already owns (it renders those itself, and decides whether a style change applies) */
  private applyStyle(el: MotionEl, props: MotionNodeOptions, prev: MotionNodeOptions | undefined) {
    const style = (props as any).style as Record<string, any> | undefined;
    const prevStyle = (prev as any)?.style as Record<string, any> | undefined;
    if (style === prevStyle) return;
    if (prevStyle) for (const key in prevStyle) if (!style || !(key in style)) el.style.removeProperty(key.startsWith('--') ? key : key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()));
    if (!style) return;
    for (const key in style) {
      const v = style[key];
      if (isMotionValue(v) || v === undefined || v === null) continue;
      if (this.ve?.hasValue(key)) continue;
      if (key.startsWith('--')) el.style.setProperty(key, String(v));
      else if (key in el.style) (el.style as any)[key] = typeof v === 'number' && !/^(opacity|zIndex|fontWeight|flex|order|lineHeight|zoom)$/.test(key) ? `${v}px` : String(v);
    }
  }

  /** popLayout: a leaving element is lifted out of flow at its last box so siblings can close up */
  private pop(el: MotionEl, isPresent: boolean, handle: PresenceHandle) {
    if (isPresent) {
      this.popStyle?.remove();
      this.popStyle = undefined;
      el.removeAttribute('data-motion-pop-id');
      return;
    }
    const parent = (el as HTMLElement).offsetParent as HTMLElement | null;
    const parentWidth = parent?.offsetWidth ?? 0, parentHeight = parent?.offsetHeight ?? 0;
    const cs = getComputedStyle(el);
    const w = parseFloat(cs.width), h = parseFloat(cs.height);
    if (!w || !h) return;
    const top = (el as HTMLElement).offsetTop, left = (el as HTMLElement).offsetLeft;
    const right = parentWidth - w - left, bottom = parentHeight - h - top;
    const isRTL = cs.direction === 'rtl';
    const x = handle.anchorX === 'left' ? (isRTL ? `right:${right}` : `left:${left}`) : isRTL ? `left:${left}` : `right:${right}`;
    const y = handle.anchorY === 'bottom' ? `bottom:${bottom}` : `top:${top}`;
    const id = `pop-${Math.random().toString(36).slice(2, 8)}`;
    el.dataset['motionPopId'] = id;
    const style = document.createElement('style');
    document.head.appendChild(style);
    style.sheet?.insertRule(`[data-motion-pop-id="${id}"]{position:absolute!important;width:${w}px!important;height:${h}px!important;${x}px!important;${y}px!important;}`);
    this.popStyle = style;
  }

  /** React unmount */
  destroy() {
    this.destroyed = true;
    pendingMounts.delete(this);
    this.unsubscribePresence?.();
    const ve = this.ve;
    if (!ve) return;
    ve.projection?.scheduleCheckAfterUnmount?.();
    this.unregister?.();
    this.popStyle?.remove();
    ve.unmount();
    this.ve = undefined;
  }
}
