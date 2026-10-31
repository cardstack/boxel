import {
  aiBotUsername,
  getMatrixServerName,
  getMatrixUsername,
  submissionBotUsername,
} from '@cardstack/runtime-common';

export type RoomInviteDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

// The service users the host may invite, by Matrix localpart. The platform
// registers these accounts itself, so no person can hold either name.
const invitableLocalparts = new Set<string>([
  aiBotUsername,
  submissionBotUsername,
]);

// Whether `inviterUserId` may invite `inviteeUserId` to a Matrix room.
//
// Boxel reveals an end user's Matrix id only to the users who share a realm
// with them, so two end users may share a room only when they share a realm
// (ADR 011 §1.5). The host can read the grants of realms the signed-in user
// owns, and nothing else: a realm-server endpoint that answered "does this
// user hold a grant on that realm" for an arbitrary user would itself reveal
// Matrix ids (ADR 011 §1.1). So the host never puts a second end user into a
// room. An invitee has to be the AI bot or the submission bot, service users
// that may share a room with anyone (ADR 011 §1.5), and it has to live on the
// inviter's own homeserver, because a service user elsewhere isn't ours
// (ADR 011 §1.7).
//
// Realm and writer accounts are service users too, but they are recognized
// only by a naming convention (`isBotAccount`) that registration doesn't
// reserve, so a person can pick a name that matches it. That convention may
// withhold something; it can't admit an invite.
export function decideRoomInvite(
  inviteeUserId: string,
  inviterUserId: string,
): RoomInviteDecision {
  let inviteeServer = getMatrixServerName(inviteeUserId);
  let inviterServer = getMatrixServerName(inviterUserId);
  if (!inviteeServer || inviteeServer !== inviterServer) {
    return {
      allowed: false,
      reason: `${inviteeUserId} is not on this homeserver`,
    };
  }
  if (!invitableLocalparts.has(getMatrixUsername(inviteeUserId))) {
    return {
      allowed: false,
      reason: `${inviteeUserId} is not the AI bot or the submission bot`,
    };
  }
  return { allowed: true };
}
