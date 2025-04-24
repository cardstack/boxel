import type Owner from '@ember/owner';
import { setOwner } from '@ember/owner';
import { inject as service } from '@ember/service';

import { md5 } from 'super-fast-md5';

import {
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  baseRealm,
  codeRefWithAbsoluteURL,
  getClass,
  type LooseSingleCardDocument,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import { basicMappings } from '@cardstack/runtime-common/helpers/ai';

import type { Base64ImageField as Base64ImageFieldType } from 'https://cardstack.com/base/base64-image';
import { relativeTo, CardDef } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type {
  FileDef,
  SerializedFile,
} from 'https://cardstack.com/base/file-api';
import type {
  CommandDefinitionSchema,
  Tool,
} from 'https://cardstack.com/base/matrix-event';

import type * as SkillCardModule from 'https://cardstack.com/base/skill-card';

import type CardService from '../services/card-service';
import type CommandService from '../services/command-service';
import type LoaderService from '../services/loader-service';
import type MatrixService from '../services/matrix-service';

export const isSkillCard = Symbol.for('is-skill-card');

interface CacheEntry {
  content: string;
  timestamp: number;
}

const CACHE_EXPIRATION_MS = 30 * 60 * 1000; // 30 minutes

export default class FileDefManager {
  private commandDefHashes: string[] = []; // hashes
  private downloadCache: Map<string, CacheEntry> = new Map();

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

  async uploadCardsAndUpdateSkillCommands(
    cards: CardDef[],
    roomId: string,
  ): Promise<FileDef[]> {
    const cardFileDefs = await this.uploadCards(cards);
    const skillCards = cards.filter((card) => isSkillCard in card);
    const roomResource = this.matrixService.roomResourcesCache.get(roomId);
    const roomSkills = roomResource?.skills ?? [];
    const updatedSkillFileDefs: FileDef[] = [];
    const updatedCommandFileDefs: FileDef[] = [];
    for (const skillCard of skillCards) {
      let matchingRoomSkill = roomSkills.find(
        (roomSkill) => roomSkill.cardId === skillCard.id,
      );
      if (matchingRoomSkill) {
        let commandDefinitions = (skillCard as SkillCardModule.SkillCard)
          .commands;
        if (commandDefinitions.length) {
          let commandDefFileDefs =
            await this.uploadCommandDefinitions(commandDefinitions);
          updatedSkillFileDefs.push(
            cardFileDefs.find((fileDef) => fileDef.sourceUrl === skillCard.id)!,
          );
          updatedCommandFileDefs.push(...commandDefFileDefs);
        }
      }
    }
    if (updatedSkillFileDefs.length || updatedCommandFileDefs.length) {
      await this.matrixService.updateStateEvent(
        roomId,
        APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
        '',
        async (currentSkillsConfig) => {
          const enabledSkillCards = [
            ...(currentSkillsConfig.enabledSkillCards || []),
          ];
          const newEnabledCards = updatedSkillFileDefs
            .map((fileDef) => fileDef.serialize())
            .filter(
              (newCard) =>
                !enabledSkillCards.some(
                  (existingCard) =>
                    existingCard.sourceUrl === newCard.sourceUrl,
                ),
            );
          const updatedEnabledCards = [
            ...enabledSkillCards,
            ...newEnabledCards,
          ].map((card) => {
            const matchingFileDef = updatedSkillFileDefs.find(
              (fileDef) => fileDef.sourceUrl === card.sourceUrl,
            );
            if (matchingFileDef) {
              return { ...card, url: matchingFileDef.url };
            }
            return card;
          });

          const disabledSkillCards = [
            ...(currentSkillsConfig.disabledSkillCards || []),
          ];
          const newDisabledCards = updatedSkillFileDefs
            .map((fileDef) => fileDef.serialize())
            .filter(
              (newCard) =>
                !enabledSkillCards.some(
                  (existingCard) =>
                    existingCard.sourceUrl === newCard.sourceUrl,
                ),
            );
          const updatedDisabledCards = [
            ...disabledSkillCards,
            ...newDisabledCards,
          ].map((card) => {
            const matchingFileDef = updatedSkillFileDefs.find(
              (fileDef) => fileDef.sourceUrl === card.sourceUrl,
            );
            if (matchingFileDef) {
              return { ...card, url: matchingFileDef.url };
            }
            return card;
          });

          let commandDefinitions = [
            ...(currentSkillsConfig.commandDefinitions || []),
          ];
          const newCommandDefinitions = updatedCommandFileDefs
            .map((fileDef) => fileDef.serialize())
            .filter(
              (newCommandDefinition) =>
                !commandDefinitions.some(
                  (commandDefinition) =>
                    commandDefinition.sourceUrl ===
                    newCommandDefinition.sourceUrl,
                ),
            );
          const updatedCommandDefinitions = [
            ...commandDefinitions,
            ...newCommandDefinitions,
          ].map((cmd) => {
            const matchingFileDef = updatedCommandFileDefs.find(
              (fileDef) => fileDef.sourceUrl === cmd.sourceUrl,
            );
            if (matchingFileDef) {
              return { ...cmd, url: matchingFileDef.url };
            }
            return cmd;
          });
          return {
            enabledSkillCards: updatedEnabledCards,
            disabledSkillCards: updatedDisabledCards,
            commandDefinitions: updatedCommandDefinitions,
          };
        },
      );
    }

    return cardFileDefs;
  }

  async uploadCards(cards: CardDef[]): Promise<FileDef[]> {
    if (!cards.length) {
      return [];
    }

    let cardEntries: {
      card: CardDef;
      serialization: LooseSingleCardDocument;
    }[] = await Promise.all(
      cards.map(async (card) => {
        let opts: CardAPI.SerializeOpts = { useAbsoluteURL: true };
        if (isSkillCard in card) {
          opts['includeComputeds'] = true;
        }

        let { Base64ImageField } = await this.loaderService.loader.import<{
          Base64ImageField: typeof Base64ImageFieldType;
        }>(`${baseRealm.url}base64-image`);
        let serialization = await this.cardService.serializeCard(card, {
          omitFields: [Base64ImageField],
          ...opts,
        });
        return { card, serialization };
      }),
    );

    return await Promise.all(
      cardEntries.map(async (entry) => {
        let fileDef = this.matrixService.fileAPI.createFileDef({
          sourceUrl: entry.card.id,
          name: entry.card.title,
          contentType: 'text/plain',
        });
        fileDef.url = await this.matrixService.uploadContent(
          JSON.stringify(entry.serialization),
          fileDef.contentType,
        );
        return fileDef;
      }),
    );
  }

  async uploadCommandDefinitions(
    commandDefinitions: SkillCardModule.CommandField[],
  ): Promise<FileDef[]> {
    if (!commandDefinitions.length) {
      return [];
    }

    // Create the command defs to get the json schema
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

      let hashKey = this.generateCommandDefHashKey(schema);
      if (!this.commandDefHashes.includes(hashKey)) {
        commandDefinitionSchemas.push(schema);
        this.commandDefHashes.push(hashKey);
      }
    }

    // Upload each command definition schema as a file
    let fileDefs = await Promise.all(
      commandDefinitionSchemas.map(async (schema) => {
        const name = schema.tool.function.name;
        const fileDef = this.matrixService.fileAPI.createFileDef({
          sourceUrl: '',
          name: name,
          contentType: 'text/plain',
        });

        fileDef.url = await this.matrixService.uploadContent(
          JSON.stringify(schema),
          fileDef.contentType,
        );

        return fileDef;
      }),
    );

    return fileDefs;
  }

  /**
   * Generates a hash key for a command definition schema.
   * @param commandDefSchema - The command definition schema to hash
   * @returns A hash key string
   */
  private generateCommandDefHashKey(
    commandDefSchema: CommandDefinitionSchema,
  ): string {
    return md5(JSON.stringify(commandDefSchema));
  }

  /**
   * Downloads a card from a SerializedFile and returns it as a LooseSingleCardDocument
   * Uses caching to avoid repeated downloads of the same file
   */
  async downloadCardFileDef(
    serializedFile: SerializedFile,
  ): Promise<LooseSingleCardDocument> {
    if (!serializedFile?.contentType?.includes('text/')) {
      throw new Error(`Unsupported file type: ${serializedFile.contentType}`);
    }

    // Check cache first
    const cachedEntry = this.downloadCache.get(serializedFile.url);
    if (
      cachedEntry &&
      Date.now() - cachedEntry.timestamp < CACHE_EXPIRATION_MS
    ) {
      return JSON.parse(cachedEntry.content) as LooseSingleCardDocument;
    }

    // Download if not in cache or expired
    const response = await this.matrixService.downloadFile(serializedFile.url);
    const content = await response.text();

    // Update cache
    this.downloadCache.set(serializedFile.url, {
      content,
      timestamp: Date.now(),
    });

    // Clean up cache if it gets too large
    if (this.downloadCache.size > 100) {
      this.cleanupCache();
    }

    return JSON.parse(content) as LooseSingleCardDocument;
  }

  /**
   * Cleans up expired entries from the download cache
   */
  private cleanupCache(): void {
    const now = Date.now();
    for (const [url, entry] of this.downloadCache.entries()) {
      if (now - entry.timestamp > CACHE_EXPIRATION_MS) {
        this.downloadCache.delete(url);
      }
    }
  }
}
