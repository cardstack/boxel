import {
    type IAuthData, MatrixEvent,
    type RoomMember,
    type EmittedEvents,
    type IEvent,
    type client,
} from 'matrix-js-sdk';
import * as MatrixSDK from 'matrix-js-sdk';
// New
import OpenAI from 'openai';

const openai = new OpenAI();

let startTime = Date.now();

async function sendStream() {

}


const MODIFY_SYSTEM_MESSAGE = "\
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
The data in the option block will be used to update things for the user behind a button so they will not see the content directly - you must give a short text summary before the option block. The option block should not contain the description. Make sure you use the option tags.\
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
function getUserMessage(request, card) {
    return `
    User request: ${request}
    Full data: ${JSON.stringify(card)}
    You may only patch the following fields: ${JSON.stringify(card.attributes)}
    `
}

async function chunkStream(stream, client, room, sentId) {
    let total = []
    let unsent = 0;
    for await (const part of stream) {
        unsent += 1;
        total.push(part);
        if (unsent > 20) {
            let content = total.map(part => part.choices[0].delta?.content).join('');
            await client.sendEvent(room.roomId, "m.room.message",
                {
                    "body": content,
                    "msgtype": "m.text",
                    "formatted_body": content,
                    "format": "org.matrix.custom.html",
                    "m.new_content": {
                        "body": content,
                        "msgtype": "m.text",
                        "formatted_body": content,
                        "format": "org.matrix.custom.html"
                    },
                    "m.relates_to": {
                        "rel_type": "m.replace",
                        "event_id": sentId,
                    }
                });
            unsent = 0;
        }
    }
    let content = total.map(part => part.choices[0].delta?.content).join('');
    await client.sendEvent(room.roomId, "m.room.message",
        {
            "body": content,
            "msgtype": "m.text",
            "formatted_body": content,
            "format": "org.matrix.custom.html",
            "m.new_content": {
                "body": content,
                "msgtype": "m.text",
                "formatted_body": content,
                "format": "org.matrix.custom.html"
            },
            "m.relates_to": {
                "rel_type": "m.replace",
                "event_id": sentId,
            }
        });
}

async function getResponse(event) {
    if (event.getContent().msgtype === "org.boxel.card") {
        let card = event.getContent().instance.data;
        console.log("Processing card: " + event);
        return await openai.chat.completions.create({
            model: "gpt-4-0613",
            messages: [
                {
                    "role": "system", "content": MODIFY_SYSTEM_MESSAGE
                },
                {
                    "role": "user", "content": getUserMessage(event.getContent().body, card)
                }],
            stream: true,
        });
    } else {
        return await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ "role": "user", "content": event.getContent().body }],
            stream: true,
        });
    }
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
        console.log(event);
        console.log(JSON.stringify(event, null, 2));
        console.log(event.getContent());
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
        let initialMessage = await client.sendHtmlMessage(room.roomId, "Thinking...", "Thinking...");
        let sentId = initialMessage.event_id;
        console.log(initialMessage);


        const stream = await getResponse(event);
        await chunkStream(stream, client, room, sentId);
        //await sendStream(stream, client, room, sentId);

        //let content = chunks.map(part => part.choices[0].delta?.content).join('');
        //await client.sendHtmlMessage(room.roomId, content, content);
        //MatrixSDK.
        //let fullcontent = total.map(part => part.choices[0].delta?.content).join('');
        //await client.sendHtmlMessage(room.roomId, fullcontent, fullcontent);

        console.log(
            // the room name will update with m.room.name events automatically
            "(%s) %s :: %s",
            room?.name,
            event.getSender(),
            event.getContent().body,
        );
    });

    await client.startClient();
    console.log('client started');
})().catch(e => {
    console.error(e);
    process.exit(1);
});
