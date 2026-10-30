import { isBotAccount } from '@cardstack/runtime-common';

export type RoomInviteDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

// Whether `inviterUserId` may invite `inviteeUserId` to a Matrix room.
//
// Boxel reveals an end user's Matrix id only to the users who share a realm
// with them, so two end users may share a room only when they share a realm
// (ADR 011 §1.5). The host can read the grants of realms the signed-in user
// owns, and nothing else: a realm-server endpoint that answered "does this
// user hold a grant on that realm" for an arbitrary user would itself reveal
// Matrix ids (ADR 011 §1.1). So the host never puts a second end user into a
// room. An invitee has to be one of the platform's service accounts, which
// may share a room with anyone (ADR 011 §1.5), and it has to live on the
// inviter's own homeserver, because a service account elsewhere isn't ours
// (ADR 011 §1.7).
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
  if (!isBotAccount(inviteeUserId)) {
    return {
      allowed: false,
      reason: `${inviteeUserId} is not one of Boxel's service users`,
    };
  }
  return { allowed: true };
}

// The part of a Matrix id after its colon, or undefined for a bare localpart.
export function getMatrixServerName(userId: string): string | undefined {
  let colon = userId.indexOf(':');
  if (colon === -1) {
    return undefined;
  }
  let server = userId.slice(colon + 1);
  return server.length > 0 ? server : undefined;
}
