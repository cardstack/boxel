import {
  MAX_CURRENT_TURN_TOOL_RESULT_MEDIA,
  MAX_CURRENT_TURN_TOOL_RESULT_MEDIA_BYTES,
  toolResultMediaRefusal,
  VIEW_ATTACHMENT_TOOL_NAME,
} from '@cardstack/runtime-common/ai';
import {
  isTextBasedContentType,
  requiredModality,
} from '@cardstack/runtime-common/ai/modality';
import type { SerializedFileDef } from '@cardstack/base/file-api';
import type {
  MatrixEvent as DiscreteMatrixEvent,
  Tool,
} from '@cardstack/base/matrix-event';
import { parseLenientJson } from '../../lenient-json.ts';

export { VIEW_ATTACHMENT_TOOL_NAME };

// Brings a media file a user attached earlier in the room back into the
// current turn. A media file's content reaches the model only on the last
// message of a request, and only until the bot has answered the message that
// attached it; after that, history lists the file by name, type and size
// alone. The tool looks the file up among the attachments of the messages
// humans sent in this room and attaches the same stored file to its result,
// so the prompt builder embeds it as tool-result media on the next request
// (see currentTurnToolResultMedia in runtime-common/ai/prompt.ts). The tool
// downloads nothing itself: the prompt builder fetches a tool-result file
// only from the homeserver's media endpoint, under the tool-result media
// limits.

// How many files one call may name: the most tool-result media files one turn
// embeds. The turn's count and byte limits still apply across all of its
// tool results, so a file a call names can still be left out of a request,
// by a later call or another tool's media. The tool description says so: an
// applied result is no promise that every file it names will be sent.
export const VIEW_ATTACHMENT_MAX_URLS = MAX_CURRENT_TURN_TOOL_RESULT_MEDIA;

export const viewAttachmentTool: Tool = {
  type: 'function',
  function: {
    name: VIEW_ATTACHMENT_TOOL_NAME,
    description:
      'Look again at an image, PDF, audio or video file the user attached ' +
      'to a message in this conversation. Its content reaches you only ' +
      'while the message that attached it is unanswered; after that the ' +
      'conversation lists the file by name, type and size alone. Call this ' +
      'when you need that content (to answer a question about the file, ' +
      "describe it or compare it) and the last message of this request doesn't " +
      'include it. The files come back attached to the result, and you see ' +
      `them on your next turn. Views up to ${VIEW_ATTACHMENT_MAX_URLS} files ` +
      'in one call. The files every tool result of a turn attaches, these ' +
      `included, share one limit of ${MAX_CURRENT_TURN_TOOL_RESULT_MEDIA} ` +
      `files and ${MAX_CURRENT_TURN_TOOL_RESULT_MEDIA_BYTES / (1024 * 1024)} ` +
      'MiB: past it the oldest are left out, and a note names them, so view ' +
      "only what you need for the step you are on. Text files don't need " +
      'it: their content is already in the message that attached them.',
    parameters: {
      type: 'object',
      properties: {
        urls: {
          type: 'array',
          minItems: 1,
          maxItems: VIEW_ATTACHMENT_MAX_URLS,
          uniqueItems: true,
          items: { type: 'string' },
          description:
            "Each file's URL exactly as the message that attached it lists " +
            'it, such as boxel-local://…/photo.jpg. Only files attached to ' +
            "the user's messages in this conversation can be viewed. List " +
            `each URL once, at most ${VIEW_ATTACHMENT_MAX_URLS} per call.`,
        },
      },
      required: ['urls'],
    },
  },
};

export interface ViewAttachmentUrlSelection {
  urls: string[];
  // The unique urls past VIEW_ATTACHMENT_MAX_URLS, so the model can be told
  // which files it did not get.
  dropped: string[];
}

// The urls a viewAttachment call names, deduplicated, in order, and capped
// at VIEW_ATTACHMENT_MAX_URLS. The cap is enforced here and not only in the
// schema, whose maxItems is a hint the model may ignore.
export function selectViewAttachmentUrls(
  argumentsJson: string,
): ViewAttachmentUrlSelection {
  let urls: unknown[] = [];
  try {
    let parsed = parseLenientJson(argumentsJson) as { urls?: unknown };
    urls = Array.isArray(parsed?.urls) ? parsed.urls : [];
  } catch {
    urls = [];
  }
  let unique: string[] = [];
  let seen = new Set<string>();
  for (let url of urls) {
    if (typeof url !== 'string' || url.trim().length === 0) {
      continue;
    }
    let key = attachmentKey(url);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(url.trim());
    }
  }
  return {
    urls: unique.slice(0, VIEW_ATTACHMENT_MAX_URLS),
    dropped: unique.slice(VIEW_ATTACHMENT_MAX_URLS),
  };
}

// The file name an attachment URL ends in, decoded, for the timeline label:
// `boxel-local://<id>/my%20photo.jpg` → `my photo.jpg`.
export function attachmentNameFromUrl(url: string): string {
  let path = url.split(/[?#]/)[0].replace(/\/+$/, '');
  let last = path.slice(path.lastIndexOf('/') + 1) || url;
  return safeDecode(last);
}

const VIEW_ATTACHMENT_LABEL_MAX = 5;

// The timeline label for a call ("View attachment: <name>" /
// "View attachments: <names>"), from its (possibly partial) arguments.
export function viewAttachmentLabel(argumentsJson: string): string {
  let names = selectViewAttachmentUrls(argumentsJson).urls.map(
    attachmentNameFromUrl,
  );
  if (names.length === 0) {
    return 'View attachments';
  }
  if (names.length === 1) {
    return `View attachment: ${names[0]}`;
  }
  let shown = names.slice(0, VIEW_ATTACHMENT_LABEL_MAX);
  let remaining = names.length - shown.length;
  let suffix = remaining > 0 ? `, and ${remaining} more` : '';
  return `View attachments: ${shown.join(', ')}${suffix}`;
}

// The files humans attached to their messages in the room, each URL mapped
// to the newest file attached under it: history tells the model that a later
// attachment of the same file supersedes earlier ones. Files the bot attached
// to anything it sent, and files attached to tool results, are not here, so
// the tool can only ever show a file a person put in this room.
export type RoomAttachments = Map<string, SerializedFileDef>;

export function roomAttachments(
  history: DiscreteMatrixEvent[],
  aiBotUserId: string,
): RoomAttachments {
  let attachments: RoomAttachments = new Map();
  for (let event of history) {
    if (event.type !== 'm.room.message' || event.sender === aiBotUserId) {
      continue;
    }
    let attachedFiles = eventData(event)?.attachedFiles;
    if (!Array.isArray(attachedFiles)) {
      continue;
    }
    for (let file of attachedFiles as SerializedFileDef[]) {
      if (typeof file?.sourceUrl === 'string' && file.sourceUrl.trim()) {
        attachments.set(attachmentKey(file.sourceUrl), file);
      }
    }
  }
  return attachments;
}

export type AttachmentLookup =
  | { ok: true; file: SerializedFileDef }
  | { ok: false; error: string };

// The stored file the tool attaches to its result for `url`, or why it
// can't: the url names no file a user attached in this room, the file is
// text (its content is already in history), or the prompt builder could never
// send it as tool-result media to the active model, whose input modalities
// are `inputModalities` (see toolResultMediaRefusal).
export function lookUpAttachment(
  url: string,
  attachments: RoomAttachments,
  inputModalities?: string[],
): AttachmentLookup {
  let file = attachments.get(attachmentKey(url));
  if (!file) {
    return {
      ok: false,
      error: `${url} was not attached to a message in this conversation. ${VIEW_ATTACHMENT_TOOL_NAME} shows only files the user attached, by the URL the message that attached them lists.`,
    };
  }
  if (!requiredModality(file.contentType)) {
    return {
      ok: false,
      error: isTextBasedContentType(file.contentType)
        ? `${url} is a text file: its content is already in the message that attached it.`
        : `${url} is not an image, PDF, audio or video file, so it can't be shown.`,
    };
  }
  let refusal = toolResultMediaRefusal(file, inputModalities);
  if (refusal) {
    // A message carries its own media without the storage and size limits,
    // so attaching the file again shows it. Nothing shows a kind of media
    // the active model doesn't take.
    let reattaching = refusal === toolResultMediaRefusal(file);
    return {
      ok: false,
      error: `${url} can't be shown: ${refusal}. ${
        reattaching
          ? 'Ask the user to attach it again if you need it.'
          : "Tell the user you can't view it with the current model."
      }`,
    };
  }
  return {
    ok: true,
    file: {
      sourceUrl: file.sourceUrl,
      url: file.url,
      ...(file.name ? { name: file.name } : {}),
      ...(file.contentType ? { contentType: file.contentType } : {}),
      ...(typeof file.contentSize === 'number'
        ? { contentSize: file.contentSize }
        : {}),
    } as SerializedFileDef,
  };
}

// The key an attachment is looked up by: the URL as the message lists it,
// with percent-encoding undone, so a model that copies the URL with its
// escapes resolved still names the same file.
function attachmentKey(url: string): string {
  return safeDecode(url.trim());
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

// A room event's `data`, which raw events carry as serialized JSON.
function eventData(
  event: DiscreteMatrixEvent,
): { attachedFiles?: unknown } | undefined {
  let data = (event.content as { data?: unknown })?.data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return undefined;
    }
  }
  return data && typeof data === 'object'
    ? (data as { attachedFiles?: unknown })
    : undefined;
}
