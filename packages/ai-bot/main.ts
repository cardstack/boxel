import {
  MatrixEvent,
  IContent,
  RoomEvent,
  RoomMemberEvent,
  createClient,
  ISendEventResponse,
  Room,
  MatrixClient,
} from 'matrix-js-sdk';

import OpenAI from 'openai';
import { APIResponse } from 'openai/core';
import { ChatCompletionChunk } from 'openai/resources/chat';
import { Stream } from 'openai/streaming';

const openai = new OpenAI();

let startTime = Date.now();

const MODIFY_SYSTEM_MESSAGE =
  "\
You are able to modify content according to user requests.\
If a user may be requesting a change, respond politely but not ingratiatingly to the user. The more complex the request, the more you can explain what you're about to do.\
\
Return up to 3 options for the user to select from, exploring a range of things the user may want. If the request has only one sensible option or they ask for something very directly you don't need to return more than one. The format of your response should be\
```\
Explanatory text\
Option 1: Description\
<option>\
{changed content}\
</option>\
Option 2: Description\
<option>\
{changed content}\
</option>\
Option 3: Description\
<option>\
{changed content}\
</option>\
```\
The data in the option block will be used to update things for the user behind a button so they will not see the content directly - you must give a short text summary before the option block. The option block should not contain the description. Make sure you use the option xml tags.\
Return only JSON inside each option block, in a compatible format with the one you receive. The contents of any field will be automatically replaced with your changes, and must follow a subset of the same format - you may miss out fields but cannot add new ones. Do not add new nested components, it will fail validation.\
Modify only the parts you are asked to. Only return modified fields.\
You must not return any fields that you do not see in the input data..";

enum ParsingMode {
  Text,
  Command,
}

function getUserMessage(request: string, card: any) {
  return `
    User request: ${request}
    Full data: ${JSON.stringify(card)}
    You may only patch the following fields: ${JSON.stringify(card.attributes)}
    `;
}

async function sendMessage(
  client: MatrixClient,
  room: Room,
  content: string,
  previous: string | undefined
) {
  if (content.startsWith('option>')) {
    content = content.replace('option>', '');
  }
  let messageObject: IContent = {
    body: content,
    msgtype: 'm.text',
    formatted_body: content,
    format: 'org.matrix.custom.html',
    'm.new_content': {
      body: content,
      msgtype: 'm.text',
      formatted_body: content,
      format: 'org.matrix.custom.html',
    },
  };
  if (previous) {
    messageObject['m.relates_to'] = {
      rel_type: 'm.replace',
      event_id: previous,
    };
  }
  return await client.sendEvent(room.roomId, 'm.room.message', messageObject);
}

async function sendOption(client: MatrixClient, room: Room, content: string) {
  let messageObject = {
    body: content,
    msgtype: 'm.text',
    formatted_body: content,
    format: 'org.matrix.custom.html',
  };
  console.log('Sending', messageObject);
  return await client.sendEvent(room.roomId, 'm.room.message', messageObject);
}

async function sendStream(
  stream: APIResponse<Stream<ChatCompletionChunk>>,
  client: MatrixClient,
  room: Room,
  append_to?: string
) {
  let content = '';
  let unsent = 0;
  let currentParsingMode: ParsingMode = ParsingMode.Text;
  for await (const part of stream) {
    console.log('Token: ', part.choices[0].delta?.content);
    // If we've not got a current message to edit and we're processing text
    // rather than structured data, start a new message to update.
    if (!append_to && currentParsingMode == ParsingMode.Text) {
      let placeholder = await sendMessage(client, room, '...', undefined);
      append_to = placeholder.event_id;
    }
    let token = part.choices[0].delta?.content;
    // The final token is undefined, so we need to break out of the loop
    if (token == undefined) {
      break;
    }

    // The parsing here has to deal with a streaming response that
    // alternates between sections of text (to stream back to the client)
    // and structured data (to batch and send in one block)
    if (token.includes('</')) {
      // Content is the text we have built up so far
      if (content.startsWith('option>')) {
        content = content.replace('option>', '');
      }
      if (content.startsWith('>')) {
        content = content.replace('>', '');
      }
      content += token.split('</')[0];
      // Now we need to drop into card mode for the stream
      await sendOption(client, room, content);
      content = '';
      currentParsingMode = ParsingMode.Text;
      unsent = 0;
    } else if (token.includes('<')) {
      currentParsingMode = ParsingMode.Command;
      // Send the last update
      let beforeTag = token.split('<')[0];
      await sendMessage(client, room, content + beforeTag, append_to);
      content = '';
      unsent = 0;
      append_to = undefined;
    } else if (token) {
      unsent += 1;
      content += part.choices[0].delta?.content;
      // buffer up to 20 tokens before sending, but only when parsing text
      if (currentParsingMode == ParsingMode.Text && unsent > 20) {
        await sendMessage(client, room, content, append_to);
        unsent = 0;
      }
    }
  }
  // Make sure we send any remaining content at the end of the stream
  if (content) {
    await sendMessage(client, room, content, append_to);
  }
}

async function getResponse(event: MatrixEvent) {
  const content: IContent = event.getContent();
  if (content.msgtype === 'org.boxel.card') {
    let card = content.instance.data;
    console.log('Processing card: ' + event);
    return await openai.chat.completions.create({
      model: 'gpt-4-0613',
      messages: [
        {
          role: 'system',
          content: MODIFY_SYSTEM_MESSAGE,
        },
        {
          role: 'user',
          content: getUserMessage(content.body, card),
        },
      ],
      stream: true,
    });
  } else {
    return await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: content.body }],
      stream: true,
    });
  }
}

(async () => {
  let client = createClient({ baseUrl: 'http://localhost:8008' });
  let auth = await client.loginWithPassword('aibot', 'pass');
  let { user_id } = auth;
  client.on(RoomMemberEvent.Membership, function (_event, member) {
    if (member.membership === 'invite' && member.userId === user_id) {
      client.joinRoom(member.roomId).then(function () {
        console.log('Auto-joined %s', member.roomId);
      });
    }
  });
  // TODO: Set this up to use a queue that gets drained
  client.on(
    RoomEvent.Timeline,
    async function (event, room, toStartOfTimeline) {
      console.log(
        '(%s) %s :: %s',
        room?.name,
        event.getSender(),
        event.getContent().body
      );

      if (event.event.origin_server_ts! < startTime) {
        return;
      }
      if (toStartOfTimeline) {
        return; // don't print paginated results
      }
      if (event.getType() !== 'm.room.message') {
        return; // only print messages
      }
      if (event.getSender() === user_id) {
        return;
      }
      let initialMessage: ISendEventResponse = await client.sendHtmlMessage(
        room!.roomId,
        'Thinking...',
        'Thinking...'
      );

      const stream = await getResponse(event);
      console.log('Receiving response', stream);
      await sendStream(stream, client, room!, initialMessage.event_id);
    }
  );

  await client.startClient();
  console.log('client started');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
