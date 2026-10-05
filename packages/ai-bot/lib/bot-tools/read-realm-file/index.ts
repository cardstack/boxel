import type { BotTool } from '../types.ts';
import { fulfillReadRealmFileCalls } from './fulfillment.ts';
import {
  READ_REALM_FILE_TOOL_NAME,
  readFilesLabel,
  readRealmFileTool,
  urlsFromReadRealmFileArguments,
} from './read.ts';

// readRealmFile: reads realm files for the model with the requesting user's
// own realm permissions (see read.ts).
export const readRealmFileBotTool: BotTool = {
  name: READ_REALM_FILE_TOOL_NAME,
  definition: readRealmFileTool,

  // Reads act on one human's realm permissions, so the room must have
  // exactly one human, and delegation must be configured.
  isOffered(room) {
    return room.realmDelegation && room.humanMemberCount === 1;
  },

  label(argumentsJson) {
    return readFilesLabel(urlsFromReadRealmFileArguments(argumentsJson));
  },

  async startTurn(room) {
    return {
      needsApproval() {
        return false;
      },
      runsNow() {
        return true;
      },
      async fulfill(calls, target) {
        let outcomes = await fulfillReadRealmFileCalls(calls, {
          client: target.client,
          roomId: target.roomId,
          requestEventId: target.requestEventId,
          agentId: target.agentId,
          onBehalfOf: room.onBehalfOf,
          delegatedUserRealmSessions: room.delegatedUserRealmSessions,
        });
        return outcomes.map((outcome) => ({
          commandRequestId: outcome.commandRequestId,
          published: true,
        }));
      },
    };
  },

  recoversFromCutOff(argumentsJson) {
    return urlsFromReadRealmFileArguments(argumentsJson).length > 0;
  },
};
