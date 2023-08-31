import './setup-logger'; // This should be first
import {
  IContent,
  RoomMemberEvent,
  RoomEvent,
  createClient,
  ISendEventResponse,
  Room,
  MatrixClient,
  IRoomEvent,
} from 'matrix-js-sdk';
import OpenAI from 'openai';
import { ChatCompletionChunk } from 'openai/resources/chat';
import { logger, aiBotUsername } from '@cardstack/runtime-common';

let log = logger('ai-bot');

/***
 * TODO:
 * When constructing the historical cards, also get the card ones so we have that context
 * Which model to use & system prompts
 * interactions?
 */

const openai = new OpenAI();

let startTime = Date.now();

interface Message {
  /**
   * The contents of the message. `content` is required for all messages, and may be
   * null for assistant messages with function calls.
   */
  content: string | null;
  /**
   * The role of the messages author. One of `system`, `user`, `assistant`, or
   * `function`.
   */
  role: 'system' | 'user' | 'assistant' | 'function';
}

const MODIFY_SYSTEM_MESSAGE =
  '\
You are able to modify content according to user requests as well as answer questions for them. You may ask any followup questions you may need.\
If a user may be requesting a change, respond politely but not ingratiatingly to the user. The more complex the request, the more you can explain what you\'re about to do.\
\
Along with the changes you want to make, you must include the card ID of the card being changed. The original card. \
Return up to 3 options for the user to select from, exploring a range of things the user may want. If the request has only one sensible option or they ask for something very directly you don\'t need to return more than one. The format of your response should be\
```\
Explanatory text\
Option 1: Description\
<option>\
{\
  "id": "originalCardID",\
  "patch": {\
    ...\
  }\
}\
</option>\
Option 2: Description\
<option>\
{\
  "id": "originalCardID",\
  "patch": {\
    ...\
  }\
}\
</option>\
Option 3: Description\
<option>\
{\
  "id": "originalCardID",\
  "patch": {\
    ...\
  }\
}\
</option>\
```\
The data in the option block will be used to update things for the user behind a button so they will not see the content directly - you must give a short text summary before the option block. The option block should not contain the description. Make sure you use the option xml tags.\
Return only JSON inside each option block, in a compatible format with the one you receive. The contents of any field will be automatically replaced with your changes, and must follow a subset of the same format - you may miss out fields but cannot add new ones. Do not add new nested components, it will fail validation.\
Modify only the parts you are asked to. Only return modified fields.\
You must not return any fields that you do not see in the input data.\
If the user hasn\'t shared any cards with you or what they\'re asking for doesn\'t make sense for the card type, you can ask them to "send their open cards" to you.';

enum ParsingMode {
  Text,
  Command,
}

function getUserMessage(event: IRoomEvent) {
  const content = event.content;
  if (content.msgtype === 'org.boxel.card') {
    let card = content.instance.data;
    let request = content.body;
    return `
    User request: ${request}
    Full data: ${JSON.stringify(card)}
    You may only patch the following fields: ${JSON.stringify(card.attributes)}
    `;
  } else {
    return content.body;
  }
}

async function sendMessage(
  client: MatrixClient,
  room: Room,
  content: string,
  previous: string | undefined,
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
  log.info(content);
  let parsedContent = JSON.parse(content);
  let patch = parsedContent['patch'];
  if (patch['attributes']) {
    patch = patch['attributes'];
  }
  let id = parsedContent['id'];

  let messageObject = {
    body: content,
    msgtype: 'org.boxel.command',
    formatted_body: 'A patch',
    format: 'org.matrix.custom.html',
    command: {
      type: 'patch',
      id: id,
      patch: {
        attributes: patch,
      },
    },
  };
  log.info(JSON.stringify(messageObject, null, 2));
  log.info('Sending', messageObject);
  return await client.sendEvent(room.roomId, 'm.room.message', messageObject);
}

async function sendStream(
  stream: AsyncIterable<ChatCompletionChunk>,
  client: MatrixClient,
  room: Room,
  append_to?: string,
) {
  let content = '';
  let unsent = 0;
  let currentParsingMode: ParsingMode = ParsingMode.Text;
  for await (const part of stream) {
    let token = part.choices[0].delta?.content;
    log.info('Token: ', token);
    // The final token is undefined, so we need to break out of the loop
    if (token == undefined) {
      break;
    }

    // If we've not got a current message to edit and we're processing text
    // rather than structured data, start a new message to update.
    if (!append_to && currentParsingMode == ParsingMode.Text) {
      let placeholder = await sendMessage(client, room, '...', undefined);
      append_to = placeholder.event_id;
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

function constructHistory(history: IRoomEvent[]) {
  const latestEventsMap = new Map<string, IRoomEvent>();
  for (let event of history) {
    let content = event.content;
    if (event.type == 'm.room.message') {
      let eventId = event.event_id!;
      if (content['m.relates_to']?.rel_type === 'm.replace') {
        eventId = content['m.relates_to']!.event_id!;
      }
      const existingEvent = latestEventsMap.get(eventId);
      if (
        !existingEvent ||
        existingEvent.origin_server_ts < event.origin_server_ts
      ) {
        latestEventsMap.set(eventId, event);
      }
    }
  }
  let latestEvents = Array.from(latestEventsMap.values());
  latestEvents.sort((a, b) => a.origin_server_ts - b.origin_server_ts);
  return latestEvents;
}

function getLastUploadedCardID(history: IRoomEvent[]): String | undefined {
  for (let event of history.slice().reverse()) {
    const content = event.content;
    if (content.msgtype === 'org.boxel.card') {
      let card = content.instance.data;
      return card.id;
    }
  }
  return undefined;
}

async function getResponse(history: IRoomEvent[]) {
  let historical_messages: Message[] = [];
  log.info(history);
  for (let event of history) {
    let body = event.content.body;
    log.info(event.sender, body);
    if (body) {
      if (event.sender === aiBotUsername) {
        historical_messages.push({
          role: 'assistant',
          content: body,
        });
      } else {
        historical_messages.push({
          role: 'user',
          content: getUserMessage(event),
        });
      }
    }
  }
  let messages: Message[] = [
    {
      role: 'system',
      content: MODIFY_SYSTEM_MESSAGE,
    },
  ];

  messages = messages.concat(historical_messages);
  log.info(messages);
  return await openai.chat.completions.create({
    model: 'gpt-4-0613',
    messages: messages,
    stream: true,
  });
}

(async () => {
  let client = createClient({
    baseUrl: process.env.MATRIX_URL || 'http://localhost:8008',
  });
  let auth = await client.loginWithPassword(
    aiBotUsername,
    process.env.BOXEL_AIBOT_PASSWORD || 'pass',
  );
  let { user_id } = auth;
  client.on(RoomMemberEvent.Membership, function (_event, member) {
    if (member.membership === 'invite' && member.userId === user_id) {
      client
        .joinRoom(member.roomId)
        .then(function () {
          log.info('Auto-joined %s', member.roomId);
        })
        .catch(function (err) {
          console.log(
            'Error joining this room, typically happens when a user invites then leaves before this is joined',
            err,
          );
        });
    }
  });

  // TODO: Set this up to use a queue that gets drained
  client.on(
    RoomEvent.Timeline,
    async function (event, room, toStartOfTimeline) {
      if (!room) {
        return;
      }
      console.log(
        '(%s) %s :: %s',
        room?.name,
        event.getSender(),
        event.getContent().body,
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
        'Thinking...',
      );

      let initial = await client.roomInitialSync(room!.roomId, 1000);
      let eventList = initial!.messages?.chunk || [];
      log.info(eventList);

      log.info('Total event list', eventList.length);
      let history: IRoomEvent[] = constructHistory(eventList);
      log.info("Compressed into just the history that's ", history.length);

      // While developing the frontend it can be handy to skip GPT and just return some data
      if (event.getContent().body.startsWith('debugpatch:')) {
        let body = event.getContent().body;
        let patchMessage = body.split('debugpatch:')[1];
        // If there's a card attached, we need to split it off to parse the json
        patchMessage = patchMessage.split('(Card')[0];
        let attributes = {};
        try {
          attributes = JSON.parse(patchMessage);
        } catch (error) {
          await sendMessage(
            client,
            room,
            'Error parsing your debug patch as JSON: ' + patchMessage,
            initialMessage.event_id,
          );
        }
        let messageObject = {
          body: 'some response, a patch',
          msgtype: 'org.boxel.command',
          formatted_body: 'some response, a patch',
          format: 'org.matrix.custom.html',
          command: {
            type: 'patch',
            id: getLastUploadedCardID(history),
            patch: {
              attributes: attributes,
            },
          },
        };
        return await client.sendEvent(
          room.roomId,
          'm.room.message',
          messageObject,
        );
      }

      const stream = await getResponse(history);
      return await sendStream(stream, client, room, initialMessage.event_id);
    },
  );

  await client.startClient();
  log.info('client started');
})().catch((e) => {
  log.error(e);
  process.exit(1);
});
