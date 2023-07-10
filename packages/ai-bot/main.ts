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
        let initialMessage = await client.sendHtmlMessage(room.roomId, "Alrighty then, let's have a think", "Alrighty then, let's have a think");
        let sentId = initialMessage.event_id;
        console.log(initialMessage);
        const stream = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ "role": "user", "content": event.getContent().body }],
            stream: true,
        });
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
