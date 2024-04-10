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

// So we want 3 cards
// One is a helper for finding items and building a list of things to buy
// The second is a helper for filling in a card

export class ProductFinder extends CardDef {
  static displayName = 'Product Finder';
  @field status = contains(StringCard);

  get aiCardFunctions() {
    // These are functions that take a card as an input, the card gets attached to the chat and the string is used as a user message
    return [];
  }

  get aiContext() {
    return {
      aiFunctions: [
        {
          type: 'function',
          function: {
            name: 'searchItems',
            description: `Given one or more search terms, get the most relevant items and their prices,
            returns a list of products available for purchase. Use keywords, when searching for sizes use just the number, 2.5 rather than 2.5mm2`,
            parameters: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'The search terms',
                },
              },
              required: ['query'],
            },
          },
        },
      ],
      systemPrompt: `You help users with building a list of items they need to build their project. You have access to a hardware store search engine to help make a list. 
      Use your general knowledge of building and construction to aid them and suggest what they need.
      Never talk about not being able to help or different countries or other complexities, assume they are competent at ensuring your suggestions are safely checked.
      Assume they have all standard tools to complete the project, and are a competent person under UK building regulations.
      Do not tell them they need electricians, builders, or other people to help, assume they are competent to do the work themselves.
      Prefer to be to the point when things are clear, but explain and summarise options.`,
    };
  }

  async searchItems(args) {
    let { query } = args;
    const searchText = encodeURIComponent(query);
    try {
      const response = await fetch(
        `http://localhost:3000/search?text=${searchText}`,
      );
      const data = await response.json();
      console.log(data);
      return data;
    } catch (error) {
      console.error('Error:', error);
      throw error;
    }
  }
}

export class InvoiceBuilder extends CardDef {
  static displayName = 'InvoiceBuilder';
  @field bill = contains(MarkdownCard);

  get aiCardFunctions() {
    // These are functions that take a card as an input, the card gets attached to the chat and the string is used as a user message
    return [];
  }

  get aiContext() {
    return {
      aiFunctions: [
        {
          type: 'function',
          function: {
            name: 'setInvoice',
            description: `Given one or more search terms, get the most relevant items and their prices,
            returns a list of products available for purchase `,
            parameters: {
              type: 'object',
              properties: {
                invoiceItems: {
                  type: 'array',
                  description: 'The items to add to the invoice',
                  items: {
                    type: 'object',
                    properties: {
                      name: {
                        type: 'string',
                        description: 'The name of the item',
                      },
                      price: {
                        type: 'number',
                        description: 'The price of the item in GBP',
                      },
                      quantity: {
                        type: 'number',
                        description: 'The quantity of the item',
                      },
                    },
                    required: ['name', 'price', 'quantity'],
                  },
                },
              },
              required: ['invoiceItems'],
            },
          },
        },
      ],
      systemPrompt: `Given a conversation between a user and a bot helping them build a list of items, convert that into an itemised list with prices and quantities.
      Use the setInvoice function to fill a invoice.
      Make sure you use the items the user has actually asked for in the conversation, there will be many suggestions and only some are ones the user actually wants.
      Try and do this without asking the user for more information, assume they are competent at ensuring your suggestions are safely checked.
      Only if absolutely required, you can check with the user about ambiguity.
      `,
    };
  }

  async setInvoice(args) {
    let { invoiceItems } = args;
    this.bill = '';
    for (let item of invoiceItems) {
      this.bill += `${item.name} - £${item.price} x ${item.quantity}\n\n`;
    }
  }
}
