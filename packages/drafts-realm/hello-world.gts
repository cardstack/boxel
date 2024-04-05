import TextAreaCard from 'https://cardstack.com/base/text-area';
import MarkdownCard from 'https://cardstack.com/base/markdown';
import StringCard from 'https://cardstack.com/base/string';
import {
  CardDef,
  Component,
  field,
  contains,
  FieldDef,
  containsMany,
} from 'https://cardstack.com/base/card-api';

import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
export class AICard extends CardDef {
  static displayName = 'ENS Helper';
  @field status = contains(StringCard);


  run(card: CardDef) {
    return 'I need an ENS domain for the attached card with id ' + card.id;
  }

  get aiContext() {
    return {
      aiFunctions: [
        {
          type: 'function',
          function: {
            name: 'register',
            description: `This function triggers the registration of a new ENS name`,
            parameters: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'The name of the ENS domain to register',
                },
              },
              required: ['name'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'checkAvailable',
            description: `Check if a particular domain is availale`,
            parameters: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'The name of the ENS domain to register',
                },
              },
              required: ['name'],
            },
          },
        },
      ],
      systemPrompt: `You help people find the perfect ENS domain name.
      You are able to use your register tool to start the process of registering a new ENS domain name.
      You can also use the checkAvailable tool to check if a domain name is available.
      You have the capability to trigger the registering flow, never tell a user you can't register a domain name unless it is not available
      The user has shared {{ attachedCards }}`,
    };
  }

  register(args) {
    let { name } = args;
    this.status = `You have successfully registered the ENS domain ${name}.`;
  }

  checkAvailable(args) {
    let { name } = args;
    return true;
  }
}

export class HelloWorld extends CardDef {
  @field fullName = contains(StringCard);
  @field heroUrl = contains(StringCard);
  @field headshotUrl = contains(StringCard);
  @field bio = contains(MarkdownCard);
  @field quote = contains(TextAreaCard);
  @field list = containsMany(FieldDef);
  static displayName = 'Hello World';

  static isolated = class Isolated extends Component<typeof this> {
    @action
    clicky() {
      console.log('Hmm');
      this.args.model.list.push(new StringCard('hi'));
    }

    <template>
      <div class='container'>
        <img class='hero' src={{@model.heroUrl}} />

        <h1>About Me</h1>
        <div>
          <img class='headshot' src={{@model.headshotUrl}} />
          <h2>About {{@model.fullName}}</h2>
          <blockquote>
            &ldquo;{{@model.quote}}&rdquo;
          </blockquote>
          <@fields.bio />
        </div>
        <@fields.list />
        <button {{on 'click' this.clicky}}>Hi there</button>
      </div>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&display=swap');
        .container {
          padding: var(--boxel-sp-xl);
        }
        h1 {
          font-family: 'DM Serif Display', serif;
          font-size: 4em;
          margin-top: 0;
          margin-bottom: 0;
        }

        .headshot {
          float: right;
          background: blue;
          width: 230px;
          height: 300px;
          border-radius: 20px;
          margin-left: 20px;
          margin-bottom: 20px;
          object-fit: cover;
        }
        .hero {
          display: block;
          height: 236px;
          width: 100%;
          object-fit: cover;
        }
        blockquote {
          border-left: 3px solid #aaa;
          hanging-punctuation: first;
          margin-left: -10px;
          padding-left: 10px;
          font-weight: bold;
          font-style: oblique;
          font-size: 1.2em;
        }
        p {
          font-size: 1.2em;
        }
        h2 {
          text-transform: uppercase;
          color: #ccc;
          font-size: 1.3em;
        }
      </style>
    </template>
  };
}
