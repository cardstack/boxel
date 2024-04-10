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
export class WeatherCard extends CardDef {
  static displayName = 'Local Weather';
  @field status = contains(StringCard);

  get aiContext() {
    return {
      
      aiFunctions: [
        {
          type: 'function',
          function: {
            name: 'getLocation',
            description: `Get the current location of the user`,
            parameters: {
              type: 'object',
              properties: {},
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'getWeather',
            description: `Get the weather at a specific location`,
            parameters: {
              type: 'object',
              properties: {
                location: {
                  type: 'string',
                  description: 'The location to get the weather for',
                },
              },
              required: ['location'],
            },
          },
        },
      ],
      systemPrompt:
        `You help users plan by checking the weather forecast for them, they may be enquiring about their current location or about something they're planning or somewhere they're travelling to. Pay attention to the shared data, it is what the user has either chosen to chare in this chat or is currently looking at
        User has shared: {{ attachedCards }}`,
      autoCall: ['getLocation', 'getWeather'],
    };
  }

  getLocation(args) {
    //this.status += `\nGetting the location.`;
    return 'Seattle, WA';
  }

  getWeather(args) {
    let { location } = args;
    this.status += `\nGetting the weather at ${location}`;
    return {
      temperature: '12 Celcius',
      precipitation: '90%',
    };
  }
}
