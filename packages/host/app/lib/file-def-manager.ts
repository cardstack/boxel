import type Owner from '@ember/owner';
import { setOwner } from '@ember/owner';
import { inject as service } from '@ember/service';

import { md5 } from 'super-fast-md5';

import {
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE,
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  baseRealm,
  codeRefWithAbsoluteURL,
  getClass,
  inferContentType,
  SupportedMimeType,
  relativeTo,
  type LooseSingleCardDocument,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import { canonicalizeMatrixMediaKey } from '@cardstack/runtime-common/ai/matrix-utils';
import { basicMappings } from '@cardstack/runtime-common/helpers/ai';

import type { default as Base64ImageFieldType } from 'https://cardstack.com/base/base64-image';
import type { CardDef } from 'https://cardstack.com/base/card-api';
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

import type CardService from '../services/card-service';
import type CommandService from '../services/command-service';
import type LoaderService from '../services/loader-service';
import type { ExtendedClient } from '../services/matrix-sdk-loader';
import type NetworkService from '../services/network';

export const isSkillCard = Symbol.for('is-skill-card');

interface CacheEntry {
  content: string;
  timestamp: number;
}

type UploadableContent = string | Uint8Array;

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

  /**
   * Downloads content from a file definition
   * @param fileDef File definition to download from
   * @returns Promise resolving to the downloaded content
   */
  downloadCardFileDef(
    serializedFileDef: SerializedFile,
  ): Promise<LooseSingleCardDocument>;

  cacheContentHashIfNeeded(event: MatrixEvent): Promise<void>;
  recacheContentHash(contentHash: string, url: string): Promise<void>;

  /**
   * Downloads content from a file definition as a file in the browser
   * @param serializedFile File definition to download from
   * @returns Promise resolving to the downloaded file in the browser
   */
  downloadAsFileInBrowser(serializedFile: SerializedFile): Promise<void>;
}

export interface PrivilegedFileDefManager extends FileDefManager {
  contentHashCache: Map<string, string>;
  invalidUrlCache: Set<string>;
  getContentHash(content: UploadableContent): Promise<string>;
}

const LOCAL_FILE_ATTACHMENT = Symbol.for('boxel-local-file-attachment');

export function attachLocalFileToFileDef(
  fileDef: FileDef,
  file: File,
): FileDef {
  (fileDef as unknown as Record<symbol, unknown>)[LOCAL_FILE_ATTACHMENT] = file;
  return fileDef;
}

function getLocalFileFromFileDef(fileDef: FileDef): File | undefined {
  let value = (fileDef as unknown as Record<symbol, unknown>)[
    LOCAL_FILE_ATTACHMENT
  ];
  return value instanceof File ? value : undefined;
}

function clearLocalFileFromFileDef(fileDef: FileDef): void {
  delete (fileDef as unknown as Record<symbol, unknown>)[LOCAL_FILE_ATTACHMENT];
}

export default class FileDefManagerImpl
  implements FileDefManager, PrivilegedFileDefManager
{
  private downloadCache: Map<string, CacheEntry> = new Map();
  // In-flight fetch promises so concurrent callers share the same network request
  private inFlightTextFetches: Map<string, Promise<string>> = new Map();
  private inFlightBlobFetches: Map<string, Promise<Blob>> = new Map();
  contentHashCache: Map<string, string> = new Map(); // Maps content hash to URL
  invalidUrlCache: Set<string> = new Set(); // Cache for URLs where content hash validation failed
  private client: ExtendedClient;
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
    client: ExtendedClient;
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

  async getContentHash(content: UploadableContent): Promise<string> {
    return md5(content);
  }

  private async getCachedUrlForContent(
    content: UploadableContent,
  ): Promise<string | null> {
    const hash = await this.getContentHash(content);
    return this.contentHashCache.get(hash) || null;
  }

  async uploadContentWithCaching(
    content: UploadableContent,
    contentType: string,
    name?: string,
  ): Promise<string> {
    // Check if we already have this content cached
    const cachedUrl = await this.getCachedUrlForContent(content);
    if (cachedUrl) {
      return cachedUrl;
    }
    let uploadBody: XMLHttpRequestBodyInit;
    if (typeof content === 'string') {
      uploadBody = content;
    } else {
      // Ensure we're uploading bytes backed by a regular ArrayBuffer
      // so Matrix SDK body types remain compatible with TS DOM types.
      let binaryContent = new Uint8Array(content.byteLength);
      binaryContent.set(content);
      uploadBody = new Blob([binaryContent], { type: contentType });
    }
    let response = await this.client.uploadContent(uploadBody, {
      type: contentType,
      name,
    });
    let url = this.client.mxcUrlToHttp(
      response.content_uri,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    );
    if (!url) {
      throw new Error('Failed to convert mxcUrl to http');
    }

    // Cache the content hash and URL
    const hash = await this.getContentHash(content);
    this.contentHashCache.set(hash, url);

    return url;
  }

  // Validates the content hash against the contents of the URL and then updates the cache
  async recacheContentHash(contentHash: string, url: string) {
    const canonicalKey = canonicalizeMatrixMediaKey(url) || url;
    if (this.invalidUrlCache.has(canonicalKey)) {
      // Skipping re-caching for this url as it was previously checked and is invalid
      return;
    }

    let content = await this.downloadContentAsText(url);
    const fetchedContentHash = await this.getContentHash(content);
    if (fetchedContentHash !== contentHash) {
      console.warn(
        `Content hash mismatch for URL: ${url}, skipping re-caching step`,
      );
      // mark the canonical key as invalid so other URL variants won't retry
      this.invalidUrlCache.add(canonicalKey);
      return;
    }

    // Normalize the URL we store in the content hash cache so consumers
    // get a usable HTTP URL. If we have an mxc:// canonical key, convert
    // it back to an HTTP download URL via the client; otherwise store the
    // original provided url.
    let storedUrl = url;
    if (canonicalKey.startsWith('mxc://')) {
      try {
        const maybeHttp = this.client.mxcUrlToHttp(
          canonicalKey,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          true,
        );
        if (maybeHttp) {
          storedUrl = maybeHttp;
        }
      } catch (e) {
        // fallback to original url
      }
    }

    // Update the cache with the normalized URL for the content hash
    this.contentHashCache.set(contentHash, storedUrl);
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
        let opts: CardAPI.SerializeOpts = {
          useAbsoluteURL: true,
          includeComputeds: true,
        };

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
          name: entry.card.cardTitle,
          contentType: SupportedMimeType.CardJson,
          contentHash,
        });
        fileDef.url = await this.uploadContentWithCaching(
          content,
          fileDef.contentType,
        );
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
        commandDef[relativeTo],
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

        fileDef.url = await this.uploadContentWithCaching(
          content,
          fileDef.contentType,
        );
        return fileDef;
      }),
    );

    return fileDefs;
  }

  async uploadFiles(files: FileDef[]) {
    let uploadedFiles = await Promise.all(
      files.map(async (file) => {
        let sourceUrl = file.sourceUrl;
        let localFile = getLocalFileFromFileDef(file);

        if (file.contentHash && file.url && file.url !== file.sourceUrl) {
          if (!this.contentHashCache.has(file.contentHash)) {
            this.contentHashCache.set(file.contentHash, file.url);
          }
          return file;
        } else if (file.contentHash) {
          let cachedUrl = this.contentHashCache.get(file.contentHash);
          if (cachedUrl) {
            file.url = cachedUrl;
            return file;
          }
        }

        let contentType: string | undefined;
        let bytes: Uint8Array;
        if (localFile) {
          sourceUrl = file.sourceUrl;
          bytes = new Uint8Array(await localFile.arrayBuffer());
          contentType =
            localFile.type ||
            file.contentType ||
            inferContentType(localFile.name || file.name);
        } else {
          if (!sourceUrl) {
            throw new Error('File needs a source URL to upload');
          }
          let response = await this.network.authedFetch(sourceUrl);
          if (!response.ok) {
            throw new Error(
              `Failed to read file at ${sourceUrl}: ${response.status} ${response.statusText}`,
            );
          }
          bytes = new Uint8Array(await response.arrayBuffer());
          contentType =
            response.headers.get('content-type') ||
            file.contentType ||
            inferContentType(file.name ?? sourceUrl.split('/').pop() ?? '');
        }

        if (!contentType) {
          throw new Error(
            `File has no content type: ${sourceUrl ?? file.name ?? '(unknown file)'}`,
          );
        }
        let contentHash = await this.getContentHash(bytes);
        let cachedUrl = this.contentHashCache.get(contentHash);
        if (cachedUrl) {
          file.url = cachedUrl;
        } else {
          file.url = await this.uploadContentWithCaching(
            bytes,
            contentType,
            file.name,
          );
          this.contentHashCache.set(contentHash, file.url);
        }

        file.contentType = contentType;
        file.contentHash = contentHash;
        file.contentSize = bytes.byteLength;

        if (!file.sourceUrl && file.contentHash) {
          let fileName = file.name ?? 'attachment';
          file.sourceUrl = `boxel-attachment://${file.contentHash}/${encodeURIComponent(fileName)}`;
        }
        clearLocalFileFromFileDef(file);

        return file;
      }),
    );

    return uploadedFiles;
  }

  async downloadContentAsBlob(serializedFile: SerializedFile): Promise<Blob> {
    const canonicalKey =
      canonicalizeMatrixMediaKey(serializedFile.url) || serializedFile.url;
    // if there's already an in-flight blob fetch for this canonical key, await it
    const inFlight = this.inFlightBlobFetches.get(canonicalKey);
    if (inFlight) {
      return await inFlight;
    }

    const fetchPromise = (async () => {
      const response = await fetch(serializedFile.url, {
        headers: {
          Authorization: `Bearer ${this.client.getAccessToken()}`,
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP error. Status: ${response.status}`);
      }
      return await response.blob();
    })();

    this.inFlightBlobFetches.set(canonicalKey, fetchPromise);
    try {
      return await fetchPromise;
    } finally {
      this.inFlightBlobFetches.delete(canonicalKey);
    }
  }

  async downloadContentAsText(url: string): Promise<string> {
    const canonicalKey = canonicalizeMatrixMediaKey(url) || url;

    // Check the cache first (text cache entries stored under canonicalKey)
    const cachedEntry = this.downloadCache.get(canonicalKey);
    if (
      cachedEntry &&
      Date.now() - cachedEntry.timestamp < CACHE_EXPIRATION_MS
    ) {
      return cachedEntry.content;
    }

    // if there's already an in-flight text fetch for this canonical key, await it
    const inFlight = this.inFlightTextFetches.get(canonicalKey);
    if (inFlight) {
      return await inFlight;
    }

    const fetchPromise = (async () => {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.client.getAccessToken()}`,
        },
      });
      if (!response.ok) {
        throw new Error(`HTTP error. Status: ${response.status}`);
      }
      const text = await response.text();

      // store text in the cache under canonicalKey for future callers
      try {
        this.downloadCache.set(canonicalKey, {
          content: text,
          timestamp: Date.now(),
        });
        if (this.downloadCache.size > 100) {
          this.cleanupCache();
        }
      } catch (e) {
        // ignore cache set failures; we still return the text
        console.warn('downloadContentAsText: failed to cache', {
          url,
          canonicalKey,
          err: e,
        });
      }

      return text;
    })();

    this.inFlightTextFetches.set(canonicalKey, fetchPromise);
    try {
      return await fetchPromise;
    } finally {
      this.inFlightTextFetches.delete(canonicalKey);
    }
  }

  async downloadAsFileInBrowser(serializedFile: SerializedFile) {
    const blob = await this.downloadContentAsBlob(serializedFile);
    // Create a URL for the blob
    const blobUrl = URL.createObjectURL(blob);

    // Create a temporary link element
    const downloadLink = document.createElement('a');
    downloadLink.href = blobUrl;
    downloadLink.download = serializedFile.name;

    // Append the link to the body, click it, and remove it
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);

    // Clean up the blob URL
    URL.revokeObjectURL(blobUrl);
  }

  /**
   * Downloads a card from a SerializedFile and returns it as a LooseSingleCardDocument
   * Uses caching to avoid repeated downloads of the same file
   */
  async downloadCardFileDef(
    serializedFile: SerializedFile,
  ): Promise<LooseSingleCardDocument> {
    if (
      !serializedFile?.contentType?.includes('text/') &&
      !serializedFile.contentType?.includes('application/vnd.card+json')
    ) {
      throw new Error(`Unsupported file type: ${serializedFile.contentType}`);
    }
    const content = await this.downloadContentAsText(serializedFile.url);
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
    const recachingPromises: Promise<void>[] = [];
    if (
      event.type === 'm.room.message' &&
      (event.content.msgtype === APP_BOXEL_MESSAGE_MSGTYPE ||
        event.content.msgtype === APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE)
    ) {
      // Handle attached files and cards
      let data = event.content.data;
      if (data?.attachedFiles) {
        for (const file of data.attachedFiles) {
          if (file.contentHash && file.url) {
            recachingPromises.push(
              this.client.recacheContentHash(file.contentHash, file.url),
            );
          }
        }
      }

      if (data?.attachedCards) {
        for (const card of data.attachedCards) {
          if (card.contentHash && card.url) {
            recachingPromises.push(
              this.client.recacheContentHash(card.contentHash, card.url),
            );
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
          recachingPromises.push(
            this.client.recacheContentHash(
              skillOrCommand.contentHash,
              skillOrCommand.url,
            ),
          );
        }
      }
    }
    await Promise.all(recachingPromises);
  }
}
