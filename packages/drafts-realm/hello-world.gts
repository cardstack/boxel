import TextAreaCard from 'https://cardstack.com/base/text-area';
import MarkdownCard from 'https://cardstack.com/base/markdown';
import StringField from 'https://cardstack.com/base/string';
import {
  CardDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';

export class HelloWorld extends CardDef {
  @field fullName = contains(StringField);
  @field heroUrl = contains(StringField);
  @field headshotUrl = contains(StringField);
  @field bio = contains(MarkdownCard);
  @field quote = contains(TextAreaCard);
  static displayName = 'Hello World';

  static isolated = class Isolated extends Component<typeof this> {
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
