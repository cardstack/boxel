/**
 * The registry behind `defineParticipantArg` (glimmer-motion/participant),
 * shared by its two halves: participant.ts registers a host's args here, and
 * node.ts applies them on every update pass. Not part of the participant API.
 */
export type ApplyArg = (element: Element, value: unknown) => void;

export const participantArgs = new Map<string, ApplyArg>();

/** split the defined participant args out of a pass's named args, applying each */
export function applyParticipantArgs(
  element: Element,
  args: Record<string, unknown>,
) {
  for (const [name, apply] of participantArgs) {
    apply(element, args[name]);
    delete args[name];
  }
}
