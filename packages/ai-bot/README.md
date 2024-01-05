# AI Bot

This is an experimental AI assistant for boxel using GPT4.

Applications can communicate with this via matrix chat rooms, it will automatically join any room it is invited to on the server.

Access to the matrix server currently equates to access to GPT4 if this bot is connected.

## Setup

### Matrix

This bot requires a matrix user to connect as. Create one as described in the matrix package documentation with the username `aibot` (`pnpm register-bot-user`). The bot will default to trying to connect with the password `pass` but you can choose your own and set the `BOXEL_AIBOT_PASSWORD` environment variable.

It will default to connecting on `http://localhost:8008/`, which can be overridden with the `MATRIX_URL` environment variable.

### Boxel Development

If you are working on boxel development, you do not need to connect this up to OpenAI.

### Access to GPT4

You can get an OpenAI api key one from the staging parameter store or ask within the team.
Set this as the `OPENAI_API_KEY` environment variable. Note that if you set this broadly (such as in your bashrc) this will be used by default for many other openai based tools.

    OPENAI_API_KEY="sk-..."

## Running

Start the server with `pnpm start` or `pnpm start-dev` for live reload.

## Usage

Open the boxel application and go into operator mode. Click the bottom right button to launch the matrix rooms.

Once logged in, create a room and invite the aibot - it should join automatically.

It will be able to see any cards shared in the chat and can respond using GPT4 if you ask for content modifications (as a start, try 'can you create some sample data for this?'). The response should stream back and give you several options, these get applied as patches to the shared card if it is in your stack.

You can deliberately trigger a specific patch by sending a message that starts `debugpatch:` and has the JSON patch you want returned. For example:

```
debugpatch:{"firstName": "David"}
```

This will return a patch with the ID of the last card you uploaded. This does not hit GPT4 and is useful for testing the integration of the two components without waiting for streaming responses.

## Testing

### Unit tests

Run `pnpm test`

### Prompts

Testing of LLMs should be done with some care as exact responses are not guaranteed.
For testing we use [promptfoo](https://promptfoo.dev).

To run these tests you must setup an API key for OpenAI. Once the prompts have run once, they will be cached locally.

    pnpm promptfoo eval

The results can be viewed in a nicer format in a browser after this with

    pnpm promptfoo view

#### Adding tests

Tests are added to the `promptfooconfig.yaml` file. Each test can take either a list of messages in the following format:

    - description: Update the name, understanding mis-spellings and world info
        vars:
            messages:
                [
                {
                    'sender': 'ian',
                    'content':
                    {
                        'msgtype': 'org.boxel.card',
                        'body': 'Can make this about Hemmingway instead?',
                        'instance':
                        {
                            'data':
                            {
                                'type': 'card',
                                'id': 'http://localhost:4201/drafts/Author/1',
                                'attributes':
                                { 'firstName': 'Bob', 'lastName': 'Enwunder' },
                                'meta':
                                {
                                    'adoptsFrom':
                                    { 'module': '../author', 'name': 'Author' },
                                },
                            },
                        },
                    },
                },
                ]
            aibot_username: '@aibot:localhost'

Alternatively you can load an event list from a file.
To do this with a chat you have had, use the `get-chat` command to load the messages from the server.

You can get the chat by room name (make sure to include the #):

    pnpm get-chat '#2023-08-28T13:14:15.914+01:00 - @ian:localhost'

Or with the room ID (room IDs start with a !)

    pnpm get-chat '!yPwdsFNrqEexxsyeLy:localhost'

These will get saved in `tests/resources/chats` with the room name.
If they do not contain confidential information then they can be committed to the repository.

To use them in a test put the file path in the vars block.
Add cut_from_end to remove the last n messages from the chat (this is useful to try getting the last response again
with a new prompt).

    - description: Update the name, understanding mis-spellings and world info
        vars:
            chat_history: tests/resources/chats/id.json
            cut_from_end

The other part of a test is a list of assertions.
See the promptfoo page for details on the types of tests.
They can include using a LLM to judge the result, which is useful for fuzzy tests like "it should not say it's a language model".

        assert:
        - type: contains-json
            value:
            {
                'required': ['id', 'patch'],
                'type': 'object',
                'properties':
                {
                    'id':
                    {
                        'type': 'string',
                        'pattern': '^http://localhost:4201/drafts/Author/1$',
                    },
                    'patch':
                    {
                        'type': 'object',
                        'properties':
                        {
                            'firstName':
                            { 'type': 'string', 'pattern': '^Ernest$' },
                            'lastName':
                            { 'type': 'string', 'pattern': '^Hemingway$' },
                        },
                        'required': ['firstName', 'lastName'],
                    },
                },
            }
