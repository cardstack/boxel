import {
  type IAuthData, MatrixEvent,
  type RoomMember,
  type EmittedEvents,
  type IEvent,
  type client,
  EventTimeline,
} from 'matrix-js-sdk';
import * as MatrixSDK from 'matrix-js-sdk';
import OpenAI from 'openai';


/***
 * TODO:
 * When constructing the historical cards, also get the card ones so we have that context
 * Which model to use & system prompts
 * interactions?
 */


const openai = new OpenAI();

let startTime = Date.now();



const MODIFY_SYSTEM_MESSAGE = "\
You are able to modify content according to user requests as well as answer questions for them. You may ask any followup questions you may need.\
If a user may be requesting a change, respond politely but not ingratiatingly to the user. The more complex the request, the more you can explain what you're about to do.\
\
Along with the changes you want to make, you must include the card ID of the card being changed. The original card. \
Return up to 3 options for the user to select from, exploring a range of things the user may want. If the request has only one sensible option or they ask for something very directly you don't need to return more than one. The format of your response should be\
```\
Explanatory text\
Option 1: Description\
<option>\
{\
  \"id\": \"originalCardID\",\
  \"patch\": {\
    ...\
  }\
}\
</option>\
Option 2: Description\
<option>\
{\
  \"id\": \"originalCardID\",\
  \"patch\": {\
    ...\
  }\
}\
</option>\
Option 3: Description\
<option>\
{\
  \"id\": \"originalCardID\",\
  \"patch\": {\
    ...\
  }\
}\
</option>\
```\
The data in the option block will be used to update things for the user behind a button so they will not see the content directly - you must give a short text summary before the option block. The option block should not contain the description. Make sure you use the option xml tags.\
Return only JSON inside each option block, in a compatible format as as the one you receive. The contents of any field will be automatically replaced with your changes, and must follow a subset of the same format - you may miss out fields but cannot add new ones. Do not add new nested components, it will fail validation.\
Modify only the parts you are asked to. Only return modified fields.\
You must not return any fields that you do not see in the input data..";

/*
Example card received

{
  "type": "m.room.message",
  "sender": "@ian:localhost",
  "content": {
    "msgtype": "org.boxel.card",
    "body": "What would it be like if this was about terry pratchett (Card: Mad As a Hatter, http://localhost:4201/demo/BlogPost/1)",
    "formatted_body": "<p>What would it be like if this was about terry pratchett</p>\n",
    "instance": {
      "data": {
        "type": "card",
        "id": "http://localhost:4201/demo/BlogPost/1",
        "attributes": {
          "title": "Mad As a Hatter",
          "slug": "mad-as-a-hatter",
          "body": "## Where it all begins\n\nThis is a story of a man named [Brady](https://eightiesforbrady.com), who was bringing up three very lovely girls under the rule of the Queen of Hearts."
        },
        "relationships": {
          "authorBio": {
            "links": {
              "self": "../Author/1"
            },
            "data": {
              "type": "card",
              "id": "http://localhost:4201/demo/Author/1"
            }
          }
        },
        "meta": {
          "adoptsFrom": {
            "module": "../blog-post",
            "name": "BlogPost"
          }
        }
      },
      "included": [
        {
          "attributes": {
            "firstName": "Alice",
            "lastName": "Enwunder",
            "photo": null,
            "body": "Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet."
          },
          "type": "card",
          "meta": {
            "adoptsFrom": {
              "module": "../author",
              "name": "Author"
            }
          },
          "id": "http://localhost:4201/demo/Author/1"
        }
      ]
    }
  },
  "origin_server_ts": 1689080209551,
  "unsigned": {
    "age": 48
  },
  "event_id": "$s3lLFVt5kerqMX7T_4WgW-7LezqzuzL36NFpOc-Iymw",
  "room_id": "!cULAFCDkOVdkmOhFAE:localhost"
}
*/
// 
// Full card data: ${JSON.stringify(card.data)}
function getUserMessage(event: MatrixEvent) {
  if (event.content.msgtype === "org.boxel.card") {
    let card = event.content.instance.data;
    let request = event.content.body;
    return `
    User request: ${request}
    Full data: ${JSON.stringify(card)}
    You may only patch the following fields: ${JSON.stringify(card.attributes)}
    `
  } else {
    return event.content.body;
  }

}

async function sendMessage(client, room, content, previous) {
  if (content.startsWith('option>')) {
    content = content.replace('option>', '');
  }
  let messageObject = {
    "body": content,
    "msgtype": "m.text",
    "formatted_body": content,
    "format": "org.matrix.custom.html",
    "m.new_content": {
      "body": content,
      "msgtype": "m.text",
      "formatted_body": content,
      "format": "org.matrix.custom.html"
    }
  };
  if (previous) {
    messageObject["m.relates_to"] = {
      "rel_type": "m.replace",
      "event_id": previous,
    }
  }
  return await client.sendEvent(room.roomId, "m.room.message", messageObject);
}

async function sendOption(client, room, content) {
  console.log(content);
  let parsedContent = JSON.parse(content);
  let patch = parsedContent["patch"];
  if (patch["attributes"]) {
    patch = patch["attributes"];
  }
  let id = parsedContent["id"];

  let messageObject = {
    "body": content,
    "msgtype": "m.org.boxel.command",
    "formatted_body": "A patch",
    "format": "org.matrix.custom.html",
    "command": {
      "type": "patch",
      "id": id,
      "patch": {
        "attributes": patch
      }
    }
  };
  console.log(JSON.stringify(messageObject, null, 2));
  console.log("Sending", messageObject);
  return await client.sendEvent(room.roomId, "m.room.message", messageObject);
}


async function sendStream(stream, client, room) {
  let append_to = undefined;
  let content = "";
  let unsent = 0;
  let state = "text";
  for await (const part of stream) {
    if (!append_to && state == "text") {
      let placeholder = await sendMessage(client, room, "...", undefined);
      append_to = placeholder.event_id;
    }
    let token = part.choices[0].delta?.content;
    if (token == undefined) {
      break;
    }

    console.log("TOKEN: ", token, token.includes('</'));
    if (token.includes('</')) {
      if (content.startsWith('option>')) {
        content = content.replace('option>', '');
      }
      if (content.startsWith('>')) {
        content = content.replace('>', '');
      }
      content += token.split('</')[0];
      // Now we need to drop into card mode for the stream
      console.log("Ended")
      await sendOption(client, room, content, undefined);
      content = "";
      state = "text";
      unsent = 0;
    } else if (token.includes('<')) {
      state = "card";
      // Send the last update
      let beforeTag = token.split('<')[0];
      await sendMessage(client, room, content + beforeTag, append_to);
      content = '';
      unsent = 0;
      append_to = undefined;
    } else if (token) {
      unsent += 1;
      content += part.choices[0].delta?.content;
      if (state == "text" && unsent > 20) {
        await sendMessage(client, room, content, append_to);
        unsent = 0;
      }
    }
  }
  await sendMessage(client, room, content, append_to);
}

function constructHistory(history: MatrixEvent[]) {
  const events = new Map<string, MatrixEvent[]>();
  for (let event of history) {
    if (event.type == "m.room.message") {
      let event_id = event.event_id;
      if (event.content['m.relates_to']?.rel_type === "m.replace") {
        event_id = event.content['m.relates_to']!.event_id;
      }
      if (!events.get(event_id)) {
        events.set(event_id, [event]);
      } else {
        events.get(event_id).push(event);
      }
    }
  }
  //console.log(events);
  //console.log("SHOULD ITERATE");
  let latest_events: MatrixEvent[] = [];
  events.forEach((event_list, event_id) => {
    //console.log(event_list);
    event_list = event_list.sort((a, b) => {
      return a.origin_server_ts - b.origin_server_ts;
    });
    latest_events.push(event_list[event_list.length - 1]);
  });
  latest_events = latest_events.sort((a, b) => {
    return a.origin_server_ts - b.origin_server_ts;
  });
  return latest_events;
  //console.log(latest_events);
}

async function getResponse(event: MatrixEvent, history: MatrixEvent[]) {
  let historical_messages = []
  console.log(history);
  for (let event of history) {
    console.log(event.sender?.name, event.content.body);
    if (event.content.body) {
      if (event.sender?.name === "aibot") {
        historical_messages.push({
          "role": "assistant",
          "content": event.content.body
        });
      } else {
        historical_messages.push({
          "role": "user",
          "content": getUserMessage(event)
        });
      }
    }
  }
  let messages = [
    {
      "role": "system", "content": MODIFY_SYSTEM_MESSAGE
    }];

  messages = messages.concat(historical_messages);
  console.log(messages);
  return await openai.chat.completions.create({
    model: "gpt-4-0613",
    messages: messages,
    stream: true,
  });
}

(async () => {
  let client = MatrixSDK.createClient({ baseUrl: 'http://localhost:8008' });
  let auth = await client.loginWithPassword(
    'aibot',
    'pass'
  );
  let { access_token, user_id, device_id } = auth;
  console.log(JSON.stringify(auth, null, 2));
  client.on(MatrixSDK.RoomMemberEvent.Membership, function (event, member) {
    if (member.membership === "invite" && member.userId === user_id) {
      client.joinRoom(member.roomId).then(function () {
        console.log("Auto-joined %s", member.roomId);
      });
    }
  });


  // SCARY WARNING ABOUT ASYNC, THIS SHOULD BE SYNC AND USE A QUEUE
  client.on(MatrixSDK.RoomEvent.Timeline, async function (event, room, toStartOfTimeline) {

    if (event.event.origin_server_ts! < startTime) {
      return;
    }
    if (toStartOfTimeline) {
      return; // don't print paginated results
    }
    if (event.getType() !== "m.room.message") {
      return; // only print messages
    }
    if (event.getSender() === user_id) {
      return;
    }

    if (event.getContent().body.includes("test")) {
      let messageObject = {
        "body": "some response, a patch",
        "msgtype": "m.org.boxel.command",
        "formatted_body": "some response, a patch",
        "format": "org.matrix.custom.html",
        "command": {
          "type": "patch",
          "id": "http://localhost:4201/demo/BlogPost/1",
          "patch": {
            "attributes": {
              "title": "My edit " + Math.random().toString(36).substring(7),
              "slug": "mad-as-a-hatter",
            }
          }
        }
      };
      return await client.sendEvent(room.roomId, "m.room.message", messageObject);
    }

    let initial = await client.roomInitialSync(room!.roomId, 1000);
    let eventList = initial!.messages?.chunk;
    console.log(eventList);

    console.log("Total event list", eventList.length);
    let history: MatrixEvent[] = constructHistory(eventList);
    console.log("Compressed into just the history that's ", history.length);


    const stream = await getResponse(event, history);
    await sendStream(stream, client, room);
  });

  await client.startClient();
  console.log('client started');
})().catch(e => {
  console.error(e);
  process.exit(1);
});
