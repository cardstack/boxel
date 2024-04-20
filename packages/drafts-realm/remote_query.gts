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
  realmURL,
  linksTo,
} from 'https://cardstack.com/base/card-api';

import {
  Schema,
  basicMappings,
  generateCardPatchCallSpecification,
} from '@cardstack/runtime-common/helpers/ai';

import { getCards, baseRealm } from '@cardstack/runtime-common';

import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';

// So we want 3 cards
// One is a helper for finding items and building a list of things to buy
// The second is a helper for filling in a card


export class RemoteQuery extends CardDef {
  static displayName = 'Remote Query';
  @field status = contains(StringCard);
  @field chosenType = linksTo(CardDef);

  get aiCardFunctions() {
    return [];
  }

  async aiContext(specGenerator) {
    console.log('Getting ai context');
    const systemPrompt = `You convert from remote data sources, images and text, to structured data that can fill in data types called "cards". You must identify what type of content the user is sharing with you as well as what structure best should represent it.
      You are fully capable of accessing information from images and urls, but you must use the extractFromURL tool to do so. You may need to call this multiple times to get what you need. Never tell the user you cannot access something remotely, use this tool.
      You must find the correct type of card (Data type) to fill in, use the findCardTypes tool to do so.
      You must fill in the data using 

      Your usual sequence will be
      * query URL for information and data
      * find card (data) types that best represent the data
      * Select the card type that best matches the data 
      * (optionally - search again to get more required information from the URL)
      * fill in the card with the data you have extracted
    `;
    const extractFromURL = {
      type: 'function',
      function: {
        name: 'extractFromURL',
        description: `This function takes a url to an image or site, and a query to get structured data from it, it will use a LLM to process the query and return the structured data.`,
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description:
                'The URL you want to extract content from. This may be an image or a webpage or a document.',
            },
            query: {
              type: 'string',
              description:
                'A detailed description of what you want to extract from the content at the URL. You may ask for structured data, specific items, terms or general information. ',
            },
          },
          required: ['query', 'url'],
        },
      },
    };

    const findCardTypes = {
      type: 'function',
      function: {
        name: 'findCardTypes',
        description: `Find a relevant card (data) type based on a query`,
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Terms useful to find the data type you want',
            },
          },
          required: ['query'],
        },
      },
    };

    const selectCardType = {
      type: 'function',
      function: {
        name: 'selectCardType',
        description: `Select a card type to fill in with data`,
        parameters: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              description:
                'The type of card you want to fill in, you must have found this with findCardTypes',
            },
          },
          required: ['type'],
        },
      },
    };

    // Initial state, no status
    if (!this.status) {
      return {
        aiFunctions: [extractFromURL, findCardTypes, selectCardType],
        systemPrompt,
      };
    } else {
      // We have a status, we are in the process of filling in a card
      const fillCard = await this.getCardParams(this.status, specGenerator);
      console.log('Fill Card', fillCard);
      return {
        aiFunctions: [extractFromURL, fillCard],
        systemPrompt,
      };
    }
  }

  async extractFromURL(args) {
    let { url, query } = args;
    try {
      const response = await fetch('http://localhost:3001/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url, query }),
      });
      const data = await response.json();
      console.log(data);
      return data;
    } catch (error) {
      console.error('Error:', error);
      throw error;
    }
  }

  async getCatalogEntries() {
    let catalogEntries = getCards({
      filter: {
        type: {
          module: `https://cardstack.com/base/catalog-entry`,
          name: 'CatalogEntry',
        },
      },
    });
    await catalogEntries.loaded;
    console.log('Catalog Entries', catalogEntries.instances);
    return catalogEntries.instances.filter(
      (x) => !x.isField && !(x.ref.name == 'CardDef'),
    );
  }

  async findCardTypes(args) {
    let cardNames = (await this.getCatalogEntries()).map(
      (x) => `${x.ref.name} : ${x.ref.description}`,
    );
    return cardNames;
  }

  async getCardParams(cardName, specGenerator) {
    let catalogEntries = await this.getCatalogEntries();
    let selected = catalogEntries.find((x) => x.ref.name == cardName);
    let example = selected.demo;

    // Generate function calls for patching currently open cards permitted for modification
    let patchSpec = await specGenerator(example);
    let fillCard = {
      type: 'function',
      function: {
        name: 'fillCard',
        description: `Insert data into a card/data type, you must be as precise as possible with the data, do not put everything into description`,
        parameters: patchSpec,
      },
    };

    return fillCard;
  }

  async fillCard(args) {
    this.status = JSON.stringify(args, null, 2);
  }

  async selectCardType(args) {
    let { type } = args;
    this.status = type;
    return 'set selected card type as ' + type;
  }
}
