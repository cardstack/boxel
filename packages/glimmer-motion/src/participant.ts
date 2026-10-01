/**
 * glimmer-motion/participant — the extension point for a host that
 * coordinates the motion elements rendered inside it.
 *
 * A host is an object registered on an ancestor element. Every `{{motion}}`
 * element carrying an `id` or a `role` joins the nearest host above it when it
 * mounts, and the host then takes part in its lifecycle:
 *
 *   register(participant)  on mount; returns the unregister the node calls on teardown
 *   claim(participant)     on teardown; true defers the VisualElement's unmount
 *   participant.release()  the host is done with a claimed element: unmount it now
 *   participant.exitComplete()  the host is done with a leaving element: tell its <Presence>
 *
 * Discovery is by DOM, the same way <LayoutGroup> and <MotionConfig> are found,
 * so nothing has to be threaded through the tree. The host element renders
 * `data-motion-host` in its markup and calls `setParticipantHost` from a
 * modifier on it. The attribute is in the markup, not set by that modifier,
 * because modifiers install children-first: a marked element whose host has
 * not installed yet resolves to no host, never to an outer one.
 *
 * No imports from node.ts here: node.ts imports this.
 */
import type { VisualElement } from 'motion-dom';

/** what a host sees of one {{motion}} element */
export interface MotionParticipant {
  element?: Element;
  /** the Presence it lives under has let it go, and the host is done with it */
  exitComplete(): void;
  /** identity across renders: the same id on a later element is the same participant */
  id: string | null;
  isPresent: boolean;
  /** stable identity for this node, for bookkeeping keyed per element */
  layoutKey: string;
  /** carries its own animate/exit/initial: a second scheduler beside the host's */
  ownAnimation?: boolean;
  /** wrapped by a <Presence> that manages it, so the host is not the only one retaining it */
  presenceManaged?: boolean;
  /** unmount a VisualElement whose teardown the host deferred by claiming it */
  release(): void;
  /** the group a host selects this element by */
  role: string | null;
  visualElement?: VisualElement;
}

export interface ParticipantHost {
  /** a destroyed participant asks whether the host still needs its element; true → the host calls release() later */
  claim(participant: MotionParticipant): boolean;
  /** a participant joins on mount; the returned function is called on its teardown, before claim() */
  register(participant: MotionParticipant): () => void;
}

/** the attribute a host element renders so its descendants can find it */
export const PARTICIPANT_HOST_ATTRIBUTE = 'data-motion-host';

const hosts = new WeakMap<Element, ParticipantHost>();

/** install (or, with `undefined`, remove) the host for an element rendered with `data-motion-host` */
export function setParticipantHost(
  el: Element,
  host: ParticipantHost | undefined,
) {
  if (host) {
    hosts.set(el, host);
  } else {
    hosts.delete(el);
  }
}

/** the host of the nearest `data-motion-host` ancestor, if it has installed */
export function closestParticipantHost(
  el: Element,
): ParticipantHost | undefined {
  const root = el.parentElement?.closest(`[${PARTICIPANT_HOST_ATTRIBUTE}]`);
  return root ? hosts.get(root) : undefined;
}

/**
 * Named args a host adds to `{{motion}}`. Empty here; a host declares its own
 * by augmenting this interface, and registers each one with
 * `defineParticipantArg` so the modifier hands it over instead of passing it to
 * the engine:
 *
 *   declare module 'glimmer-motion/participant' {
 *     interface ParticipantArgs {
 *       pack?: 'box' | 'content';
 *     }
 *   }
 *   defineParticipantArg('pack', (el, pack) => …);
 */
export interface ParticipantArgs {}

type ApplyArg = (element: Element, value: unknown) => void;

const participantArgs = new Map<string, ApplyArg>();

/**
 * Claim a named arg of `{{motion}}` for a host. On every update pass the
 * modifier removes it from the props it gives the engine and calls
 * `apply(element, value)`, with `undefined` when the arg is absent, so
 * `apply` both sets and clears. It runs for every motion element, inside a
 * host or not, from the first pass on, before the element mounts. Returns the
 * remover.
 */
export function defineParticipantArg<K extends keyof ParticipantArgs & string>(
  name: K,
  apply: (element: Element, value: ParticipantArgs[K] | undefined) => void,
) {
  participantArgs.set(name, apply as ApplyArg);
  return () => {
    if (participantArgs.get(name) === apply) {
      participantArgs.delete(name);
    }
  };
}

/** the modifier's half of defineParticipantArg: split the defined args out of a pass's named args, applying each */
export function applyParticipantArgs(
  element: Element,
  args: Record<string, unknown>,
) {
  for (const [name, apply] of participantArgs) {
    apply(element, args[name]);
    delete args[name];
  }
}
