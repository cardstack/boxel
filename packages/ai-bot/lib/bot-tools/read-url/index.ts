import { downloadFile } from '@cardstack/runtime-common/ai';
import type { SerializedFileDef } from '@cardstack/base/file-api';
import type { BotTool } from '../types.ts';
import { READ_REALM_FILE_TOOL_NAME } from '../read-realm-file/read.ts';
import { fulfillReadUrlCalls } from './fulfillment.ts';
import {
  carriesEncodedData,
  collectPreapprovedUrls,
  encodedDataRefusal,
  knownRealmOrigins,
  READ_URL_TOOL_NAME,
  readUrlLabel,
  readUrlTool,
  urlFromReadUrlArguments,
} from './read.ts';

// readUrl: reads an external web page or file for the model (see read.ts).
export const readUrlBotTool: BotTool = {
  name: READ_URL_TOOL_NAME,
  definition: readUrlTool,

  // It reads public pages on nobody's behalf, so it needs no delegation,
  // but the bot starts the continuation from its own result only when it
  // can attribute that result to the room's one human.
  isOffered(room) {
    return room.humanMemberCount === 1;
  },

  label(argumentsJson) {
    return readUrlLabel(urlFromReadUrlArguments(argumentsJson));
  },

  async startTurn(room) {
    // A URL the room gave is read; a composed one carrying encoded data is
    // refused outright; any other composed URL waits for the user.
    let preapproved = await collectPreapprovedUrls(
      room.history,
      room.aiBotUserId,
      (file) => downloadFile(room.client, file as SerializedFileDef),
    );
    let needsApproval = (url: string) =>
      !preapproved.has(url) && !carriesEncodedData(url);
    let realmOrigins = knownRealmOrigins(room.history, room.aiBotUserId);
    let realmFileReadingAllowed = room.offeredToolNames.has(
      READ_REALM_FILE_TOOL_NAME,
    );
    return {
      needsApproval(argumentsJson) {
        let url = urlFromReadUrlArguments(argumentsJson);
        return url !== undefined && needsApproval(url);
      },
      // A call without a url runs now, so its failure is published.
      runsNow(call) {
        if (call.type !== 'function') {
          return false;
        }
        let url = urlFromReadUrlArguments(call.function.arguments);
        return url === undefined || !needsApproval(url);
      },
      async fulfill(calls, target) {
        return await fulfillReadUrlCalls(calls, {
          ...target,
          refusal: (url) =>
            !preapproved.has(url) && carriesEncodedData(url)
              ? encodedDataRefusal(url)
              : undefined,
          readOptions: { realmOrigins, realmFileReadingAllowed },
        });
      },
    };
  },
};
