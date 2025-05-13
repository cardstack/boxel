import type Owner from '@ember/owner';
import { setOwner } from '@ember/owner';
import { inject as service } from '@ember/service';

import * as MatrixSDK from 'matrix-js-sdk';
import { md5 } from 'super-fast-md5';

import {
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  baseRealm,
  codeRefWithAbsoluteURL,
  getClass,
  type LooseSingleCardDocument,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import { basicMappings } from '@cardstack/runtime-common/helpers/ai';

import type { default as Base64ImageFieldType } from 'https://cardstack.com/base/base64-image';
import { relativeTo, CardDef } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type * as FileAPI from 'https://cardstack.com/base/file-api';
import type {
  FileDef,
  SerializedFile,
} from 'https://cardstack.com/base/file-api';
import type {
  CommandDefinitionSchema,
  Tool,
} from 'https://cardstack.com/base/matrix-event';

import type { MatrixEvent } from 'https://cardstack.com/base/matrix-event';
import type * as SkillModule from 'https://cardstack.com/base/skill';

import NetworkService from '../services/network';

import type CardService from '../services/card-service';
import type CommandService from '../services/command-service';
import type LoaderService from '../services/loader-service';

export const isSkillCard = Symbol.for('is-skill-card');

interface CacheEntry {
  content: string;
  timestamp: number;
}

const CACHE_EXPIRATION_MS = 30 * 60 * 1000; // 30 minutes

export interface FileDefManager {
  /**
   * Uploads cards and returns their file definitions
   * @param cards Array of cards to upload
   * @returns Promise resolving to array of file definitions
   */
  uploadCards(cards: CardDef[]): Promise<FileDef[]>;

  /**
   * Uploads command definitions and returns their file definitions
   * @param commandDefinitions Array of command definitions to upload
   * @returns Promise resolving to array of file definitions
   */
  uploadCommandDefinitions(
    commandDefinitions: SkillModule.CommandField[],
  ): Promise<FileDef[]>;

  uploadFiles(files: FileDef[]): Promise<FileDef[]>;

  uploadContent(content: string, contentType: string): Promise<string>;

  /**
   * Downloads content from a file definition
   * @param fileDef File definition to download from
   * @returns Promise resolving to the downloaded content
   */
  downloadCardFileDef(
    serializedFileDef: SerializedFile,
  ): Promise<LooseSingleCardDocument>;

  cacheContentHashIfNeeded(event: MatrixEvent): Promise<void>;
}

export default class FileDefManagerImpl implements FileDefManager {
  private downloadCache: Map<string, CacheEntry> = new Map();
  private contentHashCache: Map<string, string> = new Map(); // Maps content hash to URL
  private client: MatrixSDK.MatrixClient;
  private getCardAPI: () => typeof CardAPI;
  private getFileAPI: () => typeof FileAPI;

  @service declare private cardService: CardService;
  @service declare private commandService: CommandService;
  @service declare private loaderService: LoaderService;
  @service declare private network: NetworkService;

  constructor({
    owner,
    client,
    getCardAPI,
    getFileAPI,
  }: {
    owner: Owner;
    client: MatrixSDK.MatrixClient;
    getCardAPI: () => typeof CardAPI;
    getFileAPI: () => typeof FileAPI;
  }) {
    setOwner(this, owner);
    this.client = client;
    this.getCardAPI = getCardAPI;
    this.getFileAPI = getFileAPI;
  }

  get fileAPI() {
    return this.getFileAPI();
  }

  get cardAPI() {
    return this.getCardAPI();
  }

  private async getContentHash(content: string): Promise<string> {
    return md5(content);
  }

  private async getCachedUrlForContent(
    content: string,
  ): Promise<string | null> {
    const hash = await this.getContentHash(content);
    return this.contentHashCache.get(hash) || null;
  }

  async uploadContent(content: string, contentType: string): Promise<string> {
    // Check if we already have this content cached
    const cachedUrl = await this.getCachedUrlForContent(content);
    if (cachedUrl) {
      return cachedUrl;
    }

    let response = await this.client.uploadContent(content, {
      type: contentType,
    });
    let url = this.client.mxcUrlToHttp(response.content_uri);
    if (!url) {
      throw new Error('Failed to convert mxcUrl to http');
    }

    // Cache the content hash and URL
    const hash = await this.getContentHash(content);
    this.contentHashCache.set(hash, url);

    return url;
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

    return await Promise.all(
      cardEntries.map(async (entry) => {
        const content = JSON.stringify(entry.serialization);
        const contentHash = await this.getContentHash(content);
        let fileDef = this.fileAPI.createFileDef({
          sourceUrl: entry.card.id,
          name: entry.card.title,
          contentType: 'text/plain',
          contentHash,
        });
        fileDef.url = await this.uploadContent(content, fileDef.contentType);
        return fileDef;
      }),
    );
  }

  async uploadCommandDefinitions(
    commandDefinitions: SkillModule.CommandField[],
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
      commandDefinitionSchemas.push(schema);
    }

    // Upload each command definition schema as a file
    let fileDefs = await Promise.all(
      commandDefinitionSchemas.map(async (schema) => {
        const name = schema.tool.function.name;
        const content = JSON.stringify(schema);
        const contentHash = await this.getContentHash(content);
        const fileDef = this.fileAPI.createFileDef({
          sourceUrl: `${schema.codeRef.module}/${schema.codeRef.name}`,
          name: name,
          contentType: 'text/plain',
          contentHash,
        });

        fileDef.url = await this.uploadContent(content, fileDef.contentType);
        return fileDef;
      }),
    );

    return fileDefs;
  }

  async uploadFiles(files: FileDef[]) {
    let uploadedFiles = await Promise.all(
      files.map(async (file) => {
        if (!file.sourceUrl) {
          throw new Error('File needs a realm server source URL to upload');
        }

        let response = await this.network.authedFetch(file.sourceUrl, {
          headers: {
            Accept: 'application/vnd.card+source',
          },
        });

        // We only support uploading text files (code) for now.
        // When we start supporting other file types (pdfs, images, etc)
        // we will need to update this to support those file types.
        let text = await response.text();
        let contentType = response.headers.get('content-type');

        if (!contentType) {
          throw new Error(`File has no content type: ${file.sourceUrl}`);
        }
        file.url = await this.uploadContent(text, contentType);
        file.contentType = contentType;
        file.contentHash = await this.getContentHash(text);

        return file;
      }),
    );

    return uploadedFiles;
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
    const response = await fetch(serializedFile.url, {
      headers: {
        Authorization: `Bearer ${this.client.getAccessToken()}`,
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP error. Status: ${response.status}`);
    }
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

  async cacheContentHashIfNeeded(event: MatrixEvent) {
    if (
      event.type === 'm.room.message' &&
      event.content.msgtype === APP_BOXEL_MESSAGE_MSGTYPE
    ) {
      // Handle attached files and cards
      let data = event.content.data;
      if (data?.attachedFiles) {
        for (const file of data.attachedFiles) {
          if (file.contentHash && file.url) {
            this.contentHashCache.set(file.contentHash, file.url);
          }
        }
      }

      if (data?.attachedCards) {
        for (const card of data.attachedCards) {
          if (card.contentHash && card.url) {
            this.contentHashCache.set(card.contentHash, card.url);
          }
        }
      }
    } else if (event.type === APP_BOXEL_ROOM_SKILLS_EVENT_TYPE) {
      // Handle skills config
      const skillsContent = event.content;
      const skillsAndCommands = [
        ...(skillsContent.enabledSkillCards || []),
        ...(skillsContent.disabledSkillCards || []),
        ...(skillsContent.commandDefinitions || []),
      ];

      for (const skillOrCommand of skillsAndCommands) {
        if (skillOrCommand.contentHash && skillOrCommand.url) {
          this.contentHashCache.set(
            skillOrCommand.contentHash,
            skillOrCommand.url,
          );
        }
      }
    }
  }
}
