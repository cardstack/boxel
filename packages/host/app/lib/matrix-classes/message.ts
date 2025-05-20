import { guidFor } from '@ember/object/internals';
import { cached, tracked } from '@glimmer/tracking';

import { EventStatus } from 'matrix-js-sdk';

import { TrackedArray } from 'tracked-built-ins';

import { markdownToHtml } from '@cardstack/runtime-common';
import { escapeHtmlOutsideCodeBlocks } from '@cardstack/runtime-common/helpers/html';

import {
  parseHtmlContent,
  type HtmlTagGroup,
} from '@cardstack/host/lib/formatted-message/utils';

import { type FileDef } from 'https://cardstack.com/base/file-api';

import { RoomMember } from './member';

import type MessageCodePatchResult from './message-code-patch-result';

import type MessageCommand from './message-command';

const ErrorMessage: Record<string, string> = {
  ['M_TOO_LARGE']: 'Message is too large',
};

type RoomMessageInterface = RoomMessageRequired & RoomMessageOptional;

interface RoomMessageRequired {
  roomId: string;
  author: RoomMember;
  created: Date;
  updated: Date;
  body: string;
  eventId: string;
  status: EventStatus | null;
}

interface RoomMessageOptional {
  transactionId?: string | null;
  attachedCardIds?: string[] | null;
  attachedFiles?: FileDef[];
  isStreamingFinished?: boolean;
  index?: number;
  errorMessage?: string;
  clientGeneratedId?: string | null;
  reasoningContent?: string | null;
}

export class Message implements RoomMessageInterface {
  @tracked body: string;
  @tracked commands: TrackedArray<MessageCommand>;
  @tracked codePatchResults: TrackedArray<MessageCodePatchResult>;
  @tracked isStreamingFinished?: boolean;
  @tracked reasoningContent?: string | null;

  attachedCardIds?: string[] | null;
  attachedFiles?: FileDef[];
  attachedSkillCardIds?: string[] | null;
  index?: number;
  transactionId?: string | null;
  errorMessage?: string;
  clientGeneratedId?: string;

  author: RoomMember;
  status: EventStatus | null;
  @tracked created: Date;
  updated: Date;
  eventId: string;
  roomId: string;

  //This property is used for testing purpose
  instanceId: string;

  constructor(init: RoomMessageInterface) {
    Object.assign(this, init);
    this.author = init.author;
    this.body = init.body;
    this.eventId = init.eventId;
    this.created = init.created;
    this.updated = init.updated;
    this.status = init.status;
    this.roomId = init.roomId;
    this.attachedFiles = init.attachedFiles;
    this.reasoningContent = init.reasoningContent;
    this.commands = new TrackedArray<MessageCommand>();
    this.codePatchResults = new TrackedArray<MessageCodePatchResult>();
    this.instanceId = guidFor(this);
  }

  get isRetryable() {
    return (
      this.errorMessage === undefined ||
      (this.errorMessage && this.errorMessage !== ErrorMessage['M_TOO_LARGE'])
    );
  }

  @cached
  get bodyHTML() {
    // message is expected to be in markdown so we need to convert the markdown to html when the message is sent by the ai bot
    if (!this.body) {
      return this.body;
    }
    return markdownToHtml(escapeHtmlOutsideCodeBlocks(this.body), {
      sanitize: false,
      escapeHtmlInCodeBlocks: true,
    });
  }

  /*
    We are splitting the html into parts so that we can target the
    code blocks (<pre> tags) and apply Monaco editor to them. Here is an
    example of the html argument:

    <p>Here is some code for you.</p>
    <pre data-codeblock="javascript">const x = 1;</pre>
    <p>I hope you like this code. But here is some more!</p>
    <pre data-codeblock="javascript">const y = 2;</pre>
    <p>Feel free to use it in your project.</p>

    A drawback of this approach is that we can't render monaco editors for
    code blocks that are nested inside other elements. We should make sure
    our skills teach the model to respond with code blocks that are not nested
    inside other elements.
  */
  @cached
  get htmlParts(): HtmlTagGroup[] {
    return parseHtmlContent(this.bodyHTML, this.roomId, this.eventId);
  }
}
