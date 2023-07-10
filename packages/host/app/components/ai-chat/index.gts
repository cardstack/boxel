import Component from '@glimmer/component';
import {
  IconButton,
  Header,
  CardContainer,
  Button,
} from '@cardstack/boxel-ui';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import pick from '@cardstack/boxel-ui/helpers/pick';
import ENV from '@cardstack/host/config/environment';

export enum AiMode {
  Closed = 'closed',
  ChoosePrompt = 'choose-prompt',
  ChooseResults = 'choose-results',
  SearchPrompt = 'search-prompt',
  SearchResults = 'search-results',
}

interface Signature {
  Element: HTMLElement;
  Args: {
    mode: AiMode;
    onOpen: () => void;
    onClose: () => void;
    //onSearch: (searchString: string) => Promise<void>;
  };
  Blocks: {};
}

import { Configuration, OpenAIApi } from "openai";
const { openAIKey } = ENV;

const configuration = new Configuration({
  apiKey: openAIKey,
});
const openai = new OpenAIApi(configuration);



export default class AIChat extends Component<Signature> {
  @tracked searchInputValue = '';
  @tracked state = 'closed';
  public prompt: String = '';
  @action
  onOpen() {
  }

  @action
  onClose() {
  }

  @action
  onInput(value: string) {
    console.log(value, this);
    this.prompt = value;
  }

  @action
  async run(api: any) {
    console.log("YEEES", this.prompt, api);
    let card: Card = await api.getContext();
    console.log("Yep", card);
    const chatCompletion = await openai.createChatCompletion({
      //model: "gpt-3.5-turbo-0613",
      model: "gpt-4-0613",
      messages: [{
        role: "system", content: `You have some control over the users environment, they are in a system called Boxel with "Cards" that store and display data.
      The card you are looking at is called ${card.data.attributes.name}, 
      it is a ${card.data.attributes.type} card, and it is in the ${card.data.attributes.namespace} namespace.
      A JSON version of the data in this card is:
      ${JSON.stringify(card.data.attributes)}`
      },
      { role: "user", content: this.prompt }],
      functions: api.documentation(),
      function_call: "auto"
    });
    let response_message = chatCompletion.data.choices[0].message;
    if (response_message.function_call) {
      let function_call = response_message.function_call;
      function_call.arguments = JSON.parse(function_call.arguments);
      api[function_call.name](function_call.arguments);
      //response_message.function_call.arguments = JSON.parse(response_message.function_call.arguments);
    }

    console.log(chatCompletion.data.choices[0].message);
  }

  <template>
  <div class='ai-chat {{this.state}}' >
    <input
          class='input'
          placeholder= 'Enter search term or type a command'
          value = {{ @value }}
          {{on 'input'(pick 'target.value' this.onInput) }}
/>
  <Button
    @kind='primary'
    @size='tall'
    aria-label='Save'
    data-test-save-button

    {{on 'click'(fn this.run @api) }}
                >
      Apply
      < /Button>
      < /div>
        <style>
        .ai-chat {
      background-color: #fff;
      border-radius: 4px;
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.2);
      padding: 16px;
      margin: 16px;

      transition: width var(--boxel-transition), padding var(--boxel-transition);
    }

          .ai-chat.closed.ai-chat {
      margin: 0;
    }
    </style>
  </template>
}
