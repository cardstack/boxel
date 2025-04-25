import type Owner from '@ember/owner';
import { setOwner } from '@ember/owner';
import { inject as service } from '@ember/service';

import { type ISendEventResponse } from 'matrix-js-sdk';
import { md5 } from 'super-fast-md5';

import {
  baseRealm,
  codeRefWithAbsoluteURL,
  getClass,
  splitStringIntoChunks,
  type LooseSingleCardDocument,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import { basicMappings } from '@cardstack/runtime-common/helpers/ai';

import {
  APP_BOXEL_CARDFRAGMENT_MSGTYPE,
  APP_BOXEL_CARD_FORMAT,
  APP_BOXEL_COMMAND_DEFINITIONS_MSGTYPE,
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
} from '@cardstack/runtime-common/matrix-constants';

import type { default as Base64ImageFieldType } from 'https://cardstack.com/base/base64-image';
import type { relativeTo, CardDef } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type {
  CardFragmentContent,
  CommandDefinitionSchema,
  Tool,
} from 'https://cardstack.com/base/matrix-event';

import type * as SkillCardModule from 'https://cardstack.com/base/skill-card';

import type { RoomSkill } from '../resources/room';
import type CardService from '../services/card-service';
import type CommandService from '../services/command-service';
import type LoaderService from '../services/loader-service';
import type MatrixService from '../services/matrix-service';

const MAX_CARD_SIZE_KB = 60;
export const isSkillCard = Symbol.for('is-skill-card');

/**
 * The `CardEventPublisher` class is responsible for managing the publishing
 * of card-related events to a Matrix room. It handles serialization of cards,
 * sending card fragments, adding skill cards and their supporting command
 * definitions, and updating room state with skill configurations.
 *
 * Key responsibilities include:
 * - Serializing and publishing cards to a Matrix room.
 * - Managing card hashes to avoid duplicate publishing.
 * - Handling skill cards and their associated commands.
 * - Updating room state with skill configurations.
 * - Sending command definitions to the room's history.
 */
export default class CardEventPublisher {
  private cardHashes: Map<string, string> = new Map(); // hashes <> event id
  private commandDefHashes: string[] = []; // hashes

  @service declare private cardService: CardService;
  @service declare private commandService: CommandService;
  @service declare private loaderService: LoaderService;
  @service declare private matrixService: MatrixService;

  constructor(
    owner: Owner,
    private readonly getCardAPI: () => typeof CardAPI,
  ) {
    setOwner(this, owner);
  }

  async addCardsToRoom(cards: CardDef[], roomId: string): Promise<string[]> {
    if (!cards.length) {
      return [];
    }
    let cardEntries: {
      card: CardDef;
      serialization: LooseSingleCardDocument;
      eventId?: string;
      wasPreviouslySaved?: boolean;
      matchingRoomSkill?: RoomSkill;
    }[] = [];
    cardEntries = await Promise.all(
      cards.map(async (card) => {
        let opts: CardAPI.SerializeOpts = { useAbsoluteURL: true };
        if (isSkillCard in card) {
          opts['includeComputeds'] = true;
        }

        let { default: Base64ImageField } =
          await this.loaderService.loader.import<{
            default: typeof Base64ImageFieldType;
          }>(`${baseRealm.url}base64-image`);
        let serialization = await this.cardService.serializeCard(card, {
          omitFields: [Base64ImageField],
          ...opts,
        });
        return { card, serialization };
      }),
    );

    if (cardEntries.length) {
      for (let entry of cardEntries) {
        let hashKey = generateCardHashKey(roomId, entry.serialization);
        let eventId = this.cardHashes.get(hashKey);
        if (eventId) {
          entry.wasPreviouslySaved = true;
        } else {
          entry.wasPreviouslySaved = false;
          let responses = await this.sendCardFragments(
            roomId,
            entry.serialization,
          );
          eventId = responses[0].event_id; // we only care about the first fragment
          this.cardHashes.set(hashKey, eventId!);
        }
        entry.eventId = eventId;
      }
    }
    const skillCardEntries = cardEntries.filter(
      (entry) => isSkillCard in entry.card,
    );
    const roomResource = this.matrixService.roomResourcesCache.get(roomId);
    const roomSkills = roomResource?.skills ?? [];
    for (const skillCardEntry of skillCardEntries) {
      skillCardEntry.matchingRoomSkill = roomSkills.find(
        (roomSkill) => roomSkill.cardId === skillCardEntry.card.id,
      );
      if (skillCardEntry.matchingRoomSkill) {
        let commandDefinitions = (
          skillCardEntry.card as SkillCardModule.SkillCard
        ).commands;
        if (commandDefinitions.length) {
          await this.addCommandDefinitionsToRoomHistory(
            commandDefinitions,
            roomId,
          );
        }
      }
    }
    let savedSkillCardEntries = skillCardEntries.filter(
      (entry) => !entry.wasPreviouslySaved,
    );
    if (savedSkillCardEntries.some((entry) => entry.matchingRoomSkill)) {
      await this.matrixService.updateStateEvent(
        roomId,
        APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
        '',
        async (currentSkillsConfig) => {
          let newSkillsConfig = {
            enabledEventIds: [...(currentSkillsConfig.enabledEventIds || [])],
            disabledEventIds: [...(currentSkillsConfig.disabledEventIds || [])],
          };
          for (const skillCardEntry of savedSkillCardEntries) {
            if (skillCardEntry.matchingRoomSkill) {
              // replace the old skillEventId with the new one
              newSkillsConfig.enabledEventIds =
                newSkillsConfig.enabledEventIds.map((eventId: string) =>
                  eventId === skillCardEntry.matchingRoomSkill!.skillEventId
                    ? skillCardEntry.eventId!
                    : eventId,
                );
              newSkillsConfig.disabledEventIds =
                newSkillsConfig.disabledEventIds.map((eventId: string) =>
                  eventId === skillCardEntry.matchingRoomSkill!.skillEventId
                    ? skillCardEntry.eventId!
                    : eventId,
                );
            }
          }
          return newSkillsConfig;
        },
      );
    }

    return cardEntries.map((entry) => entry.eventId!);
  }

  async addSkillCardsToRoomHistory(
    skills: SkillCardModule.SkillCard[],
    roomId: string,
  ): Promise<string[]> {
    const commandDefinitions = skills.flatMap((skill) => skill.commands);
    if (commandDefinitions.length) {
      await this.addCommandDefinitionsToRoomHistory(commandDefinitions, roomId);
    }
    return this.addCardsToRoom(skills, roomId);
  }

  private async addCommandDefinitionsToRoomHistory(
    commandDefinitions: SkillCardModule.CommandField[],
    roomId: string,
  ) {
    // Create the command defs so getting the json schema
    // and send it to the matrix room.
    let commandDefinitionSchemas: CommandDefinitionSchema[] = [];
    const mappings = await basicMappings(this.loaderService.loader);
    for (let commandDef of commandDefinitions) {
      let absoluteCodeRef = codeRefWithAbsoluteURL(
        commandDef.codeRef,
        commandDef[Symbol.for('cardstack-relative-to') as typeof relativeTo],
      ) as ResolvedCodeRef;
      const Command = await getClass(
        absoluteCodeRef,
        this.loaderService.loader,
      );
      const command = new Command(this.commandService.commandContext);
      const name = commandDef.functionName;
      const schema: CommandDefinitionSchema = {
        codeRef: absoluteCodeRef,
        tool: {
          type: 'function' as Tool['type'],
          function: {
            name,
            description: command.description,
            parameters: {
              type: 'object',
              properties: {
                description: {
                  type: 'string',
                },
                ...(await command.getInputJsonSchema(
                  this.getCardAPI(),
                  mappings,
                )),
              },
              required: ['attributes', 'description'],
            },
          },
        },
      };
      let hashKey = generateCommandDefHashKey(roomId, schema);
      if (!this.commandDefHashes.includes(hashKey)) {
        commandDefinitionSchemas.push(schema);
        this.commandDefHashes.push(hashKey);
      }
    }
    if (commandDefinitionSchemas.length) {
      await this.matrixService.sendEvent(roomId, 'm.room.message', {
        msgtype: APP_BOXEL_COMMAND_DEFINITIONS_MSGTYPE,
        body: 'Command Definitions',
        data: {
          commandDefinitions: commandDefinitionSchemas,
        },
      });
    }
  }

  private async sendCardFragments(
    roomId: string,
    card: LooseSingleCardDocument,
  ): Promise<ISendEventResponse[]> {
    let fragments = splitStringIntoChunks(
      JSON.stringify(card),
      MAX_CARD_SIZE_KB,
    );
    let responses: ISendEventResponse[] = [];
    for (let index = fragments.length - 1; index >= 0; index--) {
      let cardFragment = fragments[index];
      let response = await this.matrixService.sendEvent(
        roomId,
        'm.room.message',
        {
          msgtype: APP_BOXEL_CARDFRAGMENT_MSGTYPE,
          format: APP_BOXEL_CARD_FORMAT,
          body: `card fragment ${index + 1} of ${fragments.length}`,
          data: {
            ...(index < fragments.length - 1
              ? { nextFragment: responses[0].event_id }
              : {}),
            cardFragment,
            index,
            totalParts: fragments.length,
          },
        } as CardFragmentContent,
      );
      responses.unshift(response);
    }
    return responses;
  }
}

function generateCardHashKey(roomId: string, card: LooseSingleCardDocument) {
  return md5(roomId + JSON.stringify(card));
}

function generateCommandDefHashKey(
  roomId: string,
  commandDefSchema: CommandDefinitionSchema,
) {
  return md5(roomId + JSON.stringify(commandDefSchema));
}
