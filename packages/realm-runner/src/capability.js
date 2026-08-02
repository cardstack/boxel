import { createTwoFilesPatch } from 'diff';
import { minimatch } from 'minimatch';

import { RealmRunnerError } from './errors.js';
import { globPattern, realmPath } from './path.js';

const DEFAULT_LIMITS = Object.freeze({
  capabilityCalls: 1_000,
  filesListed: 10_000,
  globResults: 2_000,
  grepMatches: 2_000,
  grepContextLines: 10,
  searchResults: 500,
  searchRealms: 1_000,
  searchRealmBatchSize: 2,
  searchConcurrency: 16,
  bxlSourceBytes: 64 * 1024,
  base64ReadBytes: 3 * 1024 * 1024,
  bytesRead: 16 * 1024 * 1024,
  bytesWritten: 8 * 1024 * 1024,
  filesChanged: 200,
  logs: 200,
  logBytes: 64 * 1024,
  resultBytes: 512 * 1024,
  rpcResultBytes: 4 * 1024 * 1024,
  apiRequestBytes: 4 * 1024 * 1024,
  apiResponseBytes: 4 * 1024 * 1024,
  apiTotalRequestBytes: 16 * 1024 * 1024,
  apiTotalResponseBytes: 32 * 1024 * 1024,
  apiHeaderBytes: 16 * 1024,
  diffBytes: 256 * 1024,
});

const textEncoder = new TextEncoder();
const REMOVED = Symbol('removed');
const MAX_ACTIVITY_MESSAGE_CHARS = 160;
const API_METHODS = new Set([
  'GET',
  'HEAD',
  'QUERY',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
]);
const MUTATING_API_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const FORBIDDEN_API_HEADERS = new Set([
  'authorization',
  'connection',
  'content-length',
  'cookie',
  'forwarded',
  'host',
  'proxy-authorization',
  'set-cookie',
  'transfer-encoding',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-http-method-override',
  'x-boxel-assume-user',
]);

function byteLength(value) {
  return textEncoder.encode(value).byteLength;
}

async function sha256(value) {
  let digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value));
  let hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex}`;
}

function bytesToBase64(bytes) {
  let binary = '';
  let chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

function base64ByteLength(value) {
  let padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return Math.floor((value.length * 3) / 4) - padding;
}

function jsonClone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

export class RealmCapabilityHost {
  constructor({ adapter, bxl, realmUrl, mode = 'preview', limits = {} }) {
    if (!adapter) throw new TypeError('adapter is required');
    if (!realmUrl) throw new TypeError('realmUrl is required');
    if (!['preview', 'commit'].includes(mode)) {
      throw new TypeError(`Unsupported mode: ${mode}`);
    }
    this.adapter = adapter;
    this.bxl = bxl;
    this.realmUrl = realmUrl;
    this.mode = mode;
    this.limits = Object.freeze({ ...DEFAULT_LIMITS, ...limits });
    this.overlay = new Map();
    this.baseline = new Map();
    this.fileList = undefined;
    this.scopedFileLists = new Map();
    this.scopedReads = new Map();
    this.base64Reads = new Map();
    this.readableRealmUrls = undefined;
    this.writableRealmUrls = undefined;
    this.logs = [];
    this.effects = [];
    this.logBytes = 0;
    this.stats = {
      capabilityCalls: 0,
      filesRead: 0,
      filesChanged: 0,
      bytesRead: 0,
      bytesWritten: 0,
      apiRequests: 0,
      apiBytesSent: 0,
      apiBytesReceived: 0,
    };
  }

  countCall() {
    this.stats.capabilityCalls += 1;
    if (this.stats.capabilityCalls > this.limits.capabilityCalls) {
      throw new RealmRunnerError(
        'OPERATION_LIMIT',
        'Realm capability-call limit exceeded',
      );
    }
  }

  countRead(content) {
    this.stats.filesRead += 1;
    this.countReadBytes(content);
  }

  countReadBytes(content) {
    this.countReadByteCount(byteLength(content));
  }

  countReadByteCount(bytes) {
    this.stats.bytesRead += bytes;
    if (this.stats.bytesRead > this.limits.bytesRead) {
      throw new RealmRunnerError(
        'BYTE_LIMIT',
        'Realm read-byte limit exceeded',
      );
    }
  }

  invalidateRawMutationCaches(scope, targetRealm) {
    this.readableRealmUrls = undefined;
    this.writableRealmUrls = undefined;

    let preserveStagedBaselines = () => {
      for (let filePath of this.baseline.keys()) {
        if (!this.overlay.has(filePath)) this.baseline.delete(filePath);
      }
    };
    let clearScopedRealm = (realmUrl) => {
      this.scopedFileLists.delete(realmUrl);
      for (let key of this.scopedReads.keys()) {
        if (key.startsWith(`${realmUrl}\u0000`)) this.scopedReads.delete(key);
      }
      for (let key of this.base64Reads.keys()) {
        if (key.startsWith(`${realmUrl}\u0000`)) this.base64Reads.delete(key);
      }
    };

    if (scope === 'server') {
      this.fileList = undefined;
      preserveStagedBaselines();
      this.scopedFileLists.clear();
      this.scopedReads.clear();
      this.base64Reads.clear();
    } else if (targetRealm === this.realmUrl) {
      this.fileList = undefined;
      preserveStagedBaselines();
      clearScopedRealm(this.realmUrl);
    } else if (targetRealm) {
      clearScopedRealm(targetRealm);
    }
  }

  async loadFileList() {
    if (!this.fileList) {
      let paths = await this.adapter.listFiles(
        this.realmUrl,
        this.limits.apiResponseBytes,
      );
      if (paths.length > this.limits.filesListed) {
        throw new RealmRunnerError(
          'RESULT_LIMIT',
          `Realm contains more than ${this.limits.filesListed} files`,
        );
      }
      this.fileList = new Set(paths.map(realmPath));
    }
    return this.fileList;
  }

  isCurrentRealm(realmUrl) {
    return realmUrl === undefined || realmUrl === this.realmUrl;
  }

  async authorizeReadableRealm(realmUrl) {
    if (this.isCurrentRealm(realmUrl)) return this.realmUrl;
    if (typeof realmUrl !== 'string' || realmUrl.length === 0) {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        'Scoped Realm URL must be a non-empty string',
      );
    }
    let canonical;
    try {
      let url = new URL(realmUrl);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      canonical = url.href.endsWith('/') ? url.href : `${url.href}/`;
    } catch {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        'Scoped Realm reads require an absolute HTTP(S) Realm URL',
      );
    }
    if (!this.readableRealmUrls) {
      let grants = await this.listRealms({ permission: 'read' });
      this.readableRealmUrls = new Set(grants.map((grant) => grant.url));
    }
    if (!this.readableRealmUrls.has(canonical)) {
      throw new RealmRunnerError(
        'CAPABILITY_DENIED',
        `Active Boxel profile has no read grant for Realm ${canonical}`,
      );
    }
    return canonical;
  }

  async authorizeWritableRealm(realmUrl) {
    if (this.isCurrentRealm(realmUrl)) return this.realmUrl;
    let canonical = await this.authorizeReadableRealm(realmUrl);
    if (!this.writableRealmUrls) {
      let grants = await this.listRealms({ permission: 'write' });
      this.writableRealmUrls = new Set(grants.map((grant) => grant.url));
    }
    if (!this.writableRealmUrls.has(canonical)) {
      throw new RealmRunnerError(
        'CAPABILITY_DENIED',
        `Active Boxel profile has no write grant for Realm ${canonical}`,
      );
    }
    return canonical;
  }

  async listFor(realmUrl) {
    if (this.isCurrentRealm(realmUrl)) return this.list();
    realmUrl = await this.authorizeReadableRealm(realmUrl);
    let cached = this.scopedFileLists.get(realmUrl);
    if (cached) return [...cached];
    let paths = await this.adapter.listFiles(
      realmUrl,
      this.limits.apiResponseBytes,
    );
    if (paths.length > this.limits.filesListed) {
      throw new RealmRunnerError(
        'RESULT_LIMIT',
        `Realm contains more than ${this.limits.filesListed} files`,
      );
    }
    let files = paths.map(realmPath).sort();
    this.scopedFileLists.set(realmUrl, files);
    return [...files];
  }

  async baselineFor(filePath) {
    if (this.baseline.has(filePath)) return this.baseline.get(filePath);
    let content = await this.adapter.readText(
      this.realmUrl,
      filePath,
      this.limits.bytesRead - this.stats.bytesRead,
    );
    this.baseline.set(filePath, content);
    if (content !== undefined) this.countRead(content);
    return content;
  }

  async readText(filePath, realmUrl) {
    filePath = realmPath(filePath);
    if (!this.isCurrentRealm(realmUrl)) {
      realmUrl = await this.authorizeReadableRealm(realmUrl);
      let key = `${realmUrl}\u0000${filePath}`;
      if (this.scopedReads.has(key)) {
        let cached = this.scopedReads.get(key);
        if (cached === undefined) {
          throw new RealmRunnerError(
            'NOT_FOUND',
            `Realm file not found: ${filePath}`,
          );
        }
        return cached;
      }
      let content = await this.adapter.readText(
        realmUrl,
        filePath,
        this.limits.bytesRead - this.stats.bytesRead,
      );
      this.scopedReads.set(key, content);
      if (content === undefined) {
        throw new RealmRunnerError(
          'NOT_FOUND',
          `Realm file not found: ${filePath}`,
        );
      }
      this.countRead(content);
      return content;
    }
    if (this.overlay.has(filePath)) {
      let staged = this.overlay.get(filePath);
      if (staged === REMOVED) {
        throw new RealmRunnerError(
          'NOT_FOUND',
          `Realm file not found: ${filePath}`,
        );
      }
      return staged;
    }
    let content = await this.baselineFor(filePath);
    if (content === undefined) {
      throw new RealmRunnerError(
        'NOT_FOUND',
        `Realm file not found: ${filePath}`,
      );
    }
    return content;
  }

  async readBase64(filePath, realmUrl) {
    filePath = realmPath(filePath);
    if (this.isCurrentRealm(realmUrl) && this.overlay.has(filePath)) {
      let content = this.overlay.get(filePath);
      if (content === REMOVED) {
        throw new RealmRunnerError(
          'NOT_FOUND',
          `Realm file not found: ${filePath}`,
        );
      }
      return bytesToBase64(textEncoder.encode(content));
    }
    let targetRealm = this.realmUrl;
    if (!this.isCurrentRealm(realmUrl)) {
      targetRealm = await this.authorizeReadableRealm(realmUrl);
    }
    let key = `${targetRealm}\u0000${filePath}`;
    if (this.base64Reads.has(key)) return this.base64Reads.get(key);
    let base64 = await this.adapter.readBase64(
      targetRealm,
      filePath,
      Math.min(
        this.limits.base64ReadBytes,
        this.limits.bytesRead - this.stats.bytesRead,
      ),
    );
    if (base64 === undefined) {
      throw new RealmRunnerError(
        'NOT_FOUND',
        `Realm file not found: ${filePath}`,
      );
    }
    let bytes = base64ByteLength(base64);
    if (bytes > this.limits.base64ReadBytes) {
      throw new RealmRunnerError(
        'BYTE_LIMIT',
        `Binary read exceeds ${this.limits.base64ReadBytes} bytes`,
      );
    }
    this.stats.filesRead += 1;
    this.countReadByteCount(bytes);
    this.base64Reads.set(key, base64);
    return base64;
  }

  async exists(filePath, realmUrl) {
    filePath = realmPath(filePath);
    if (!this.isCurrentRealm(realmUrl)) {
      return (await this.listFor(realmUrl)).includes(filePath);
    }
    if (this.overlay.has(filePath)) {
      return this.overlay.get(filePath) !== REMOVED;
    }
    if (this.baseline.has(filePath))
      return this.baseline.get(filePath) !== undefined;
    let files = await this.loadFileList();
    return files.has(filePath);
  }

  async list() {
    let files = new Set(await this.loadFileList());
    for (let [filePath, content] of this.overlay) {
      if (content === REMOVED) files.delete(filePath);
      else files.add(filePath);
    }
    return [...files].sort();
  }

  async glob(pattern, options = {}, realmUrl) {
    options ??= {};
    pattern = globPattern(pattern);
    let ignores = options.ignore ?? [];
    ignores = Array.isArray(ignores) ? ignores : [ignores];
    if (!ignores.every((ignore) => typeof ignore === 'string')) {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        'glob ignore must be a string or array of strings',
      );
    }
    ignores = ignores.map(globPattern);
    let files = await this.listFor(realmUrl);
    let matchOptions = {
      dot: options.dot === true,
      nocase: false,
      nonegate: true,
      noext: false,
    };
    let matches = files.filter(
      (filePath) =>
        minimatch(filePath, pattern, matchOptions) &&
        !ignores.some((ignore) => minimatch(filePath, ignore, matchOptions)),
    );
    let max = options.maxResults ?? this.limits.globResults;
    if (
      !Number.isSafeInteger(max) ||
      max < 1 ||
      max > this.limits.globResults
    ) {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        `maxResults must be between 1 and ${this.limits.globResults}`,
      );
    }
    if (matches.length > max) {
      throw new RealmRunnerError(
        'RESULT_LIMIT',
        `Glob matched ${matches.length} files; limit is ${max}`,
      );
    }
    return matches;
  }

  async stat(filePath, realmUrl) {
    filePath = realmPath(filePath);
    if (!(await this.exists(filePath, realmUrl))) {
      throw new RealmRunnerError(
        'NOT_FOUND',
        `Realm file not found: ${filePath}`,
      );
    }
    let content = await this.readText(filePath, realmUrl);
    return {
      path: filePath,
      type: 'file',
      size: byteLength(content),
      hash: await sha256(content),
      staged: this.isCurrentRealm(realmUrl) && this.overlay.has(filePath),
    };
  }

  async grep(pattern, options = {}, realmUrl) {
    options ??= {};
    if (typeof options !== 'object' || Array.isArray(options)) {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        'grep options must be an object',
      );
    }

    let isSerializedRegex =
      pattern &&
      typeof pattern === 'object' &&
      pattern.kind === 'regex' &&
      typeof pattern.source === 'string';
    if (typeof pattern !== 'string' && !isSerializedRegex) {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        'grep pattern must be a string or RegExp',
      );
    }
    if (typeof pattern === 'string' && pattern.length === 0) {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        'grep pattern must not be empty',
      );
    }

    let maxMatches = options.maxMatches ?? this.limits.grepMatches;
    if (
      !Number.isSafeInteger(maxMatches) ||
      maxMatches < 1 ||
      maxMatches > this.limits.grepMatches
    ) {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        `maxMatches must be between 1 and ${this.limits.grepMatches}`,
      );
    }
    let contextLines = options.contextLines ?? 0;
    if (
      !Number.isSafeInteger(contextLines) ||
      contextLines < 0 ||
      contextLines > this.limits.grepContextLines
    ) {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        `contextLines must be between 0 and ${this.limits.grepContextLines}`,
      );
    }

    let globs = options.glob ?? '**/*';
    globs = Array.isArray(globs) ? globs : [globs];
    if (!globs.every((pattern) => typeof pattern === 'string')) {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        'grep glob must be a string or array of strings',
      );
    }
    let ignores = options.ignore ?? [];
    ignores = Array.isArray(ignores) ? ignores : [ignores];
    if (!ignores.every((pattern) => typeof pattern === 'string')) {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        'grep ignore must be a string or array of strings',
      );
    }
    let candidates;
    if (options.files !== undefined) {
      if (!Array.isArray(options.files)) {
        throw new RealmRunnerError(
          'INVALID_ARGUMENT',
          'grep files must be an array of paths, URLs, or search hits',
        );
      }
      if (options.files.length > this.limits.globResults) {
        throw new RealmRunnerError(
          'RESULT_LIMIT',
          `grep files contains more than ${this.limits.globResults} candidates`,
        );
      }
      let grants = await this.listRealms({ permission: 'read' });
      let realmUrls = grants
        .map((grant) => grant.url)
        .sort((a, b) => b.length - a.length);
      candidates = [];
      for (let candidate of options.files) {
        let raw =
          typeof candidate === 'string'
            ? candidate
            : candidate && typeof candidate.id === 'string'
              ? candidate.id
              : candidate && typeof candidate.path === 'string'
                ? candidate.path
                : undefined;
        if (raw === undefined) {
          throw new RealmRunnerError(
            'INVALID_ARGUMENT',
            'grep files entries must be paths, URLs, or objects with an id/path string',
          );
        }
        let targetRealm = realmUrl;
        let path = raw;
        let id;
        if (/^https?:\/\//i.test(raw)) {
          targetRealm = realmUrls.find((url) => raw.startsWith(url));
          if (!targetRealm) {
            throw new RealmRunnerError(
              'CAPABILITY_DENIED',
              `grep candidate is outside the active profile's readable Realms: ${raw}`,
            );
          }
          path = raw.slice(targetRealm.length);
          id = raw;
        }
        path = realmPath(path);
        if (
          !globs.some((pattern) =>
            minimatch(path, pattern, { dot: true, nonegate: true }),
          ) ||
          ignores.some((pattern) =>
            minimatch(path, pattern, { dot: true, nonegate: true }),
          )
        ) {
          continue;
        }
        candidates.push({ path, realmUrl: targetRealm, id });
      }
      candidates.sort((a, b) => (a.id ?? a.path).localeCompare(b.id ?? b.path));
    } else {
      let paths = new Set();
      for (let pattern of globs) {
        for (let path of await this.glob(pattern, undefined, realmUrl))
          paths.add(path);
      }
      candidates = [...paths]
        .filter(
          (path) =>
            !ignores.some((pattern) =>
              minimatch(path, pattern, { dot: true, nonegate: true }),
            ),
        )
        .sort()
        .map((path) => ({ path, realmUrl }));
    }

    let caseSensitive = options.caseSensitive !== false;
    let literal = options.literal === true || typeof pattern === 'string';
    let expression;
    let needle;
    if (literal) {
      needle = String(typeof pattern === 'string' ? pattern : pattern.source);
      if (!caseSensitive) needle = needle.toLowerCase();
    } else {
      let flags = String(pattern.flags ?? '').replace(/[gy]/g, '');
      if (!caseSensitive && !flags.includes('i')) flags += 'i';
      if (pattern.source.length > 2_048) {
        throw new RealmRunnerError(
          'INVALID_ARGUMENT',
          'grep RegExp source exceeds 2048 characters',
        );
      }
      expression = new RegExp(pattern.source, `${flags}g`);
    }

    let matches = [];
    for (let candidate of candidates) {
      let { path } = candidate;
      let content;
      try {
        content = await this.readText(path, candidate.realmUrl);
      } catch (error) {
        if (error?.code === 'BINARY_FILE') continue;
        throw error;
      }
      let lines = content.split(/\r?\n/);
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        let line = lines[lineIndex];
        let columns = [];
        if (literal) {
          let haystack = caseSensitive ? line : line.toLowerCase();
          let offset = 0;
          while (offset <= haystack.length) {
            let index = haystack.indexOf(needle, offset);
            if (index === -1) break;
            columns.push(index);
            offset = index + Math.max(needle.length, 1);
          }
        } else {
          expression.lastIndex = 0;
          let match;
          while ((match = expression.exec(line))) {
            columns.push(match.index);
            if (match[0].length === 0) expression.lastIndex += 1;
          }
        }
        for (let column of columns) {
          let entry = {
            path,
            ...(candidate.id === undefined ? {} : { id: candidate.id }),
            line: lineIndex + 1,
            column: column + 1,
            text: line,
          };
          if (contextLines > 0) {
            entry.before = lines.slice(
              Math.max(0, lineIndex - contextLines),
              lineIndex,
            );
            entry.after = lines.slice(
              lineIndex + 1,
              lineIndex + 1 + contextLines,
            );
          }
          matches.push(entry);
          if (matches.length >= maxMatches) return matches;
        }
      }
    }
    return matches;
  }

  async stageWrite(filePath, content) {
    filePath = realmPath(filePath);
    if (typeof content !== 'string') {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        'writeText content must be a string',
      );
    }
    if (!this.baseline.has(filePath)) await this.baselineFor(filePath);
    let previous = this.overlay.get(filePath);
    let priorBytes =
      previous === undefined || previous === REMOVED ? 0 : byteLength(previous);
    this.stats.bytesWritten += byteLength(content) - priorBytes;
    if (this.stats.bytesWritten > this.limits.bytesWritten) {
      throw new RealmRunnerError(
        'BYTE_LIMIT',
        'Realm write-byte limit exceeded',
      );
    }
    if (
      !this.overlay.has(filePath) &&
      this.overlay.size >= this.limits.filesChanged
    ) {
      throw new RealmRunnerError(
        'OPERATION_LIMIT',
        'Realm changed-file limit exceeded',
      );
    }
    this.overlay.set(filePath, content);
    this.stats.filesChanged = this.overlay.size;
    return { path: filePath, staged: true };
  }

  async remove(filePath) {
    filePath = realmPath(filePath);
    let before = await this.baselineFor(filePath);
    if (before === undefined) {
      if (
        this.overlay.has(filePath) &&
        this.overlay.get(filePath) !== REMOVED
      ) {
        this.overlay.delete(filePath);
        this.stats.filesChanged = this.overlay.size;
        return { path: filePath, staged: false };
      }
      throw new RealmRunnerError(
        'NOT_FOUND',
        `Realm file not found: ${filePath}`,
      );
    }
    if (
      !this.overlay.has(filePath) &&
      this.overlay.size >= this.limits.filesChanged
    ) {
      throw new RealmRunnerError(
        'OPERATION_LIMIT',
        'Realm changed-file limit exceeded',
      );
    }
    this.overlay.set(filePath, REMOVED);
    this.stats.filesChanged = this.overlay.size;
    return { path: filePath, staged: true };
  }

  async replace(filePath, search, replacement, options = {}) {
    options ??= {};
    if (
      typeof search !== 'string' ||
      search.length === 0 ||
      typeof replacement !== 'string'
    ) {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        'replace requires non-empty string search and string replacement',
      );
    }
    let content = await this.readText(filePath);
    let parts = content.split(search);
    let matches = parts.length - 1;
    let expected = options.expectedMatches;
    if (expected !== undefined && matches !== expected) {
      throw new RealmRunnerError(
        'MATCH_COUNT_MISMATCH',
        `Expected ${expected} matches in ${filePath}; found ${matches}`,
      );
    }
    if (matches === 0) {
      throw new RealmRunnerError(
        'MATCH_COUNT_MISMATCH',
        `No matches found in ${filePath}`,
      );
    }
    await this.stageWrite(filePath, parts.join(replacement));
    return { path: realmPath(filePath), matches };
  }

  async appendText(filePath, content) {
    filePath = realmPath(filePath);
    if (typeof content !== 'string') {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        'appendText content must be a string',
      );
    }
    let before = (await this.exists(filePath))
      ? await this.readText(filePath)
      : '';
    return this.stageWrite(filePath, before + content);
  }

  async lint(filePath, realmUrl) {
    filePath = realmPath(filePath);
    let source = await this.readText(filePath, realmUrl);
    return this.adapter.lint(realmUrl ?? this.realmUrl, filePath, source);
  }

  async readTranspiled(filePath, realmUrl) {
    filePath = realmPath(filePath);
    if (!this.isCurrentRealm(realmUrl)) {
      realmUrl = await this.authorizeReadableRealm(realmUrl);
    }
    let content = await this.adapter.readTranspiled(
      realmUrl ?? this.realmUrl,
      filePath,
      this.limits.bytesRead - this.stats.bytesRead,
    );
    this.countReadBytes(content);
    return content;
  }

  async apiRead(scope, method, path, body, options = {}, realmUrl) {
    options ??= {};
    if (
      typeof options !== 'object' ||
      Array.isArray(options) ||
      (options.accept !== undefined && typeof options.accept !== 'string') ||
      (options.contentType !== undefined &&
        typeof options.contentType !== 'string')
    ) {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        'API read accept and contentType options must be strings',
      );
    }
    if (
      (options.accept && byteLength(options.accept) > 512) ||
      (options.contentType && byteLength(options.contentType) > 512)
    ) {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        'API content type header exceeds 512 bytes',
      );
    }
    if (method === 'Query') {
      let encoded;
      try {
        encoded = JSON.stringify(body ?? null);
      } catch (error) {
        throw new RealmRunnerError(
          'INVALID_ARGUMENT',
          `API query body must be JSON-serializable: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (byteLength(encoded) > 256 * 1024) {
        throw new RealmRunnerError(
          'BYTE_LIMIT',
          'API query body exceeds 256 KiB',
        );
      }
    }
    let adapterMethod = `${scope}${method}`;
    let targetRealm =
      scope === 'realm'
        ? realmUrl
          ? await this.authorizeReadableRealm(realmUrl)
          : this.realmUrl
        : undefined;
    let result =
      scope === 'realm'
        ? await this.adapter[adapterMethod](
            targetRealm,
            path,
            ...(method === 'Query' ? [body, options] : [options]),
          )
        : await this.adapter[adapterMethod](
            path,
            ...(method === 'Query' ? [body, options] : [options]),
          );
    if (Number.isSafeInteger(result.bodyBytes)) {
      this.countReadByteCount(result.bodyBytes);
    } else {
      this.countReadBytes(JSON.stringify(result.body ?? null));
    }
    let publicResult = { ...result };
    delete publicResult.bodyBytes;
    return publicResult;
  }

  async apiRequest(
    scope,
    method,
    path,
    options = {},
    realmUrl,
    allowCrossRealmWrite = false,
  ) {
    options ??= {};
    if (typeof method !== 'string' || !API_METHODS.has(method.toUpperCase())) {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        'API method must be GET, HEAD, QUERY, POST, PUT, PATCH, or DELETE',
      );
    }
    method = method.toUpperCase();
    if (MUTATING_API_METHODS.has(method)) {
      if (realmUrl && !allowCrossRealmWrite) {
        throw new RealmRunnerError(
          'CAPABILITY_DENIED',
          'Cross-Realm writes require realm.open(url, { write: true })',
        );
      }
      if (this.mode !== 'commit') {
        throw new RealmRunnerError(
          'CAPABILITY_DENIED',
          `API ${method} requests require Realm Script commit mode`,
        );
      }
    }
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        'API request options must be an object',
      );
    }

    let responseType = options.responseType ?? 'auto';
    if (!['auto', 'text', 'base64'].includes(responseType)) {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        "API responseType must be 'auto', 'text', or 'base64'",
      );
    }
    let bodyType = options.bodyType;
    if (bodyType === undefined) {
      bodyType =
        options.body === undefined
          ? 'none'
          : typeof options.body === 'string'
            ? 'text'
            : 'json';
    }
    if (!['none', 'json', 'text', 'base64'].includes(bodyType)) {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        "API bodyType must be 'none', 'json', 'text', or 'base64'",
      );
    }
    if (['GET', 'HEAD'].includes(method) && bodyType !== 'none') {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        `${method} API requests cannot include a body`,
      );
    }
    if (
      (bodyType === 'text' || bodyType === 'base64') &&
      typeof options.body !== 'string'
    ) {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        `API ${bodyType} body must be a string`,
      );
    }

    let headers = options.headers ?? {};
    if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        'API headers must be an object of string values',
      );
    }
    let headerBytes = 0;
    let safeHeaders = {};
    for (let [name, value] of Object.entries(headers)) {
      let lowerName = name.toLowerCase();
      if (
        !/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name) ||
        typeof value !== 'string' ||
        /[\r\n]/.test(value)
      ) {
        throw new RealmRunnerError(
          'INVALID_ARGUMENT',
          'API headers must contain valid names and single-line string values',
        );
      }
      if (
        FORBIDDEN_API_HEADERS.has(lowerName) ||
        (lowerName.startsWith('x-boxel-') &&
          lowerName !== 'x-boxel-client-request-id')
      ) {
        throw new RealmRunnerError(
          'CAPABILITY_DENIED',
          `Realm Script cannot set the ${name} header`,
        );
      }
      headerBytes += byteLength(name) + byteLength(value);
      safeHeaders[name] = value;
    }
    if (headerBytes > this.limits.apiHeaderBytes) {
      throw new RealmRunnerError(
        'BYTE_LIMIT',
        'API request headers exceed the configured byte limit',
      );
    }

    for (let optionName of ['accept', 'contentType']) {
      if (
        options[optionName] !== undefined &&
        (typeof options[optionName] !== 'string' ||
          byteLength(options[optionName]) > 512 ||
          /[\r\n]/.test(options[optionName]))
      ) {
        throw new RealmRunnerError(
          'INVALID_ARGUMENT',
          `API ${optionName} must be a single-line string no larger than 512 bytes`,
        );
      }
    }

    let requestBytes = 0;
    if (bodyType === 'json') {
      let encoded;
      try {
        encoded = JSON.stringify(options.body ?? null);
      } catch (error) {
        throw new RealmRunnerError(
          'INVALID_ARGUMENT',
          `API JSON body must be serializable: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      requestBytes = byteLength(encoded);
    } else if (bodyType === 'text') {
      requestBytes = byteLength(options.body);
    } else if (bodyType === 'base64') {
      try {
        atob(options.body);
      } catch {
        throw new RealmRunnerError(
          'INVALID_ARGUMENT',
          'API base64 body is not valid base64',
        );
      }
      requestBytes = base64ByteLength(options.body);
    }
    if (requestBytes > this.limits.apiRequestBytes) {
      throw new RealmRunnerError(
        'BYTE_LIMIT',
        'API request body exceeds the configured byte limit',
      );
    }
    if (
      this.stats.apiBytesSent + requestBytes >
      this.limits.apiTotalRequestBytes
    ) {
      throw new RealmRunnerError(
        'BYTE_LIMIT',
        'Cumulative API request bodies exceed the configured byte limit',
      );
    }

    let responseBudget = Math.min(
      this.limits.apiResponseBytes,
      this.limits.apiTotalResponseBytes - this.stats.apiBytesReceived,
    );
    if (responseBudget < 0) {
      throw new RealmRunnerError(
        'BYTE_LIMIT',
        'Cumulative API responses exceed the configured byte limit',
      );
    }

    let targetRealm =
      scope === 'realm'
        ? realmUrl
          ? MUTATING_API_METHODS.has(method)
            ? await this.authorizeWritableRealm(realmUrl)
            : await this.authorizeReadableRealm(realmUrl)
          : this.realmUrl
        : undefined;
    let normalizedOptions = {
      body: options.body,
      bodyType,
      responseType,
      maxResponseBytes: responseBudget,
      headers: safeHeaders,
      ...(options.accept === undefined ? {} : { accept: options.accept }),
      ...(options.contentType === undefined
        ? {}
        : { contentType: options.contentType }),
    };
    this.stats.apiRequests += 1;
    this.stats.apiBytesSent += requestBytes;
    let effect;
    if (MUTATING_API_METHODS.has(method)) {
      effect = {
        scope,
        ...(scope === 'realm' ? { realm: targetRealm } : {}),
        method,
        path,
        status: null,
        ok: null,
      };
      this.effects.push(effect);
    }
    let result;
    // If this throws, the effect keeps a null outcome: a transport failure
    // cannot prove whether the remote mutation completed.
    try {
      result =
        scope === 'realm'
          ? await this.adapter.realmRequest(
              targetRealm,
              method,
              path,
              normalizedOptions,
            )
          : await this.adapter.serverRequest(method, path, normalizedOptions);
    } finally {
      if (MUTATING_API_METHODS.has(method)) {
        this.invalidateRawMutationCaches(scope, targetRealm);
      }
    }
    if (effect) {
      effect.status = result.status;
      effect.ok = result.ok;
    }
    let responseBytes = Number.isSafeInteger(result.bodyBytes)
      ? result.bodyBytes
      : responseType === 'base64' && typeof result.body === 'string'
        ? base64ByteLength(result.body)
        : byteLength(
            typeof result.body === 'string'
              ? result.body
              : JSON.stringify(result.body ?? null),
          );
    if (responseBytes > this.limits.apiResponseBytes) {
      throw new RealmRunnerError(
        'BYTE_LIMIT',
        'API response body exceeds the configured byte limit',
      );
    }
    if (
      this.stats.apiBytesReceived + responseBytes >
      this.limits.apiTotalResponseBytes
    ) {
      throw new RealmRunnerError(
        'BYTE_LIMIT',
        'Cumulative API responses exceed the configured byte limit',
      );
    }
    this.stats.apiBytesReceived += responseBytes;
    let publicResult = { ...result };
    delete publicResult.bodyBytes;
    return publicResult;
  }

  async listRealms(options = {}) {
    options ??= {};
    if (
      typeof options !== 'object' ||
      Array.isArray(options) ||
      ![undefined, 'read', 'write'].includes(options.permission)
    ) {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        "listRealms permission must be 'read' or 'write'",
      );
    }
    let grants = await this.adapter.listRealms();
    if (options.permission === 'read') {
      grants = grants.filter((grant) => grant.canRead);
    } else if (options.permission === 'write') {
      grants = grants.filter((grant) => grant.canWrite);
    }
    if (grants.length > this.limits.searchRealms) {
      throw new RealmRunnerError(
        'RESULT_LIMIT',
        `Realm discovery returned ${grants.length} realms; limit is ${this.limits.searchRealms}`,
      );
    }
    return grants;
  }

  async search(query = {}, options = {}) {
    query ??= {};
    options ??= {};
    if (
      typeof query !== 'object' ||
      Array.isArray(query) ||
      typeof options !== 'object' ||
      Array.isArray(options)
    ) {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        'search requires a query object and an options object',
      );
    }

    let requestedRealms = options.realms;
    let realmUrls;
    if (requestedRealms === undefined || requestedRealms === 'current') {
      realmUrls = [this.realmUrl];
    } else if (requestedRealms === 'all') {
      realmUrls = (await this.listRealms({ permission: 'read' })).map(
        (grant) => grant.url,
      );
    } else if (typeof requestedRealms === 'string') {
      realmUrls = [requestedRealms];
    } else if (
      Array.isArray(requestedRealms) &&
      requestedRealms.every(
        (realmUrl) => typeof realmUrl === 'string' && realmUrl.length > 0,
      )
    ) {
      realmUrls = [...requestedRealms];
    } else {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        "search options.realms must be 'current', 'all', a Realm URL, or an array of Realm URLs",
      );
    }

    realmUrls = [...new Set(realmUrls)];
    if (realmUrls.length === 0) return [];
    if (realmUrls.length > this.limits.searchRealms) {
      throw new RealmRunnerError(
        'RESULT_LIMIT',
        `Search spans ${realmUrls.length} realms; limit is ${this.limits.searchRealms}`,
      );
    }
    realmUrls = await Promise.all(
      realmUrls.map((realmUrl) => this.authorizeReadableRealm(realmUrl)),
    );

    let batches = [];
    for (
      let offset = 0;
      offset < realmUrls.length;
      offset += this.limits.searchRealmBatchSize
    ) {
      batches.push(
        realmUrls.slice(offset, offset + this.limits.searchRealmBatchSize),
      );
    }

    let resultsByBatch = new Array(batches.length);
    let nextBatch = 0;
    let searchWorker = async () => {
      while (nextBatch < batches.length) {
        let index = nextBatch++;
        resultsByBatch[index] = await this.adapter.search(
          batches[index],
          query,
        );
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(this.limits.searchConcurrency, batches.length) },
        searchWorker,
      ),
    );

    let results = [];
    let seen = new Set();
    for (let batchResults of resultsByBatch) {
      for (let item of batchResults) {
        let key =
          item && typeof item === 'object' && item.id
            ? `${item.type ?? ''}\u0000${item.id}`
            : JSON.stringify(item);
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(item);
        if (results.length > this.limits.searchResults) {
          throw new RealmRunnerError(
            'RESULT_LIMIT',
            `Search returned more than ${this.limits.searchResults} items`,
          );
        }
      }
    }
    return results;
  }

  evaluateBxl(expression, input, options = {}) {
    if (!this.bxl) {
      throw new RealmRunnerError(
        'BXL_NOT_FOUND',
        'BXL is not configured for this Realm Runner',
      );
    }
    if (
      typeof expression !== 'string' ||
      expression.length === 0 ||
      byteLength(expression) > this.limits.bxlSourceBytes
    ) {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        `BXL source must be a non-empty string no larger than ${this.limits.bxlSourceBytes} bytes`,
      );
    }
    options ??= {};
    if (
      typeof options !== 'object' ||
      Array.isArray(options) ||
      ![undefined, 'auto', 'jq', 'readable'].includes(options.syntax)
    ) {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        "BXL syntax must be 'auto', 'jq', or 'readable'",
      );
    }
    try {
      return this.bxl.evaluate(expression, input, options);
    } catch (error) {
      throw new RealmRunnerError(
        'BXL_ERROR',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  captureLog(level, args) {
    if (this.logs.length >= this.limits.logs) return;
    let entry = { level, args: jsonClone(args) };
    let size = byteLength(JSON.stringify(entry));
    if (this.logBytes + size > this.limits.logBytes) return;
    this.logBytes += size;
    this.logs.push(entry);
  }

  activityDetails(value) {
    let details = typeof value === 'string' ? { message: value } : value;
    if (!details || typeof details !== 'object' || Array.isArray(details)) {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        'realm.activity requires a message string or activity object',
      );
    }
    let message = details.message;
    if (typeof message !== 'string') {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        'Realm activity message must be a string',
      );
    }
    message = [...message]
      .map((character) => {
        let code = character.charCodeAt(0);
        return code < 32 || code === 127 ? ' ' : character;
      })
      .join('')
      .trim();
    if (message.length === 0 || message.length > MAX_ACTIVITY_MESSAGE_CHARS) {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        `Realm activity message must be 1-${MAX_ACTIVITY_MESSAGE_CHARS} characters`,
      );
    }
    let phase = details.phase;
    if (
      phase !== undefined &&
      (typeof phase !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(phase))
    ) {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        'Realm activity phase must be a lowercase identifier',
      );
    }
    let current = details.current;
    let total = details.total;
    for (let [name, number] of [
      ['current', current],
      ['total', total],
    ]) {
      if (
        number !== undefined &&
        (!Number.isSafeInteger(number) || number < 0 || number > 1_000_000_000)
      ) {
        throw new RealmRunnerError(
          'INVALID_ARGUMENT',
          `Realm activity ${name} must be a non-negative safe integer`,
        );
      }
    }
    if (current !== undefined && total !== undefined && current > total) {
      throw new RealmRunnerError(
        'INVALID_ARGUMENT',
        'Realm activity current cannot exceed total',
      );
    }
    return {
      message,
      ...(phase === undefined ? {} : { phase }),
      ...(current === undefined ? {} : { current }),
      ...(total === undefined ? {} : { total }),
    };
  }

  async dispatch(operation, args) {
    this.countCall();
    switch (operation) {
      case 'current':
        return { url: this.realmUrl, mode: this.mode };
      case 'activity':
        return this.activityDetails(args[0]);
      case 'realms.list':
        return this.listRealms(args[0]);
      case 'bxl.evaluate':
        return this.evaluateBxl(args[0], args[1], args[2]);
      case 'fs.list':
        return this.list();
      case 'fs.glob':
        return this.glob(args[0], args[1]);
      case 'fs.grep':
        return this.grep(args[0], args[1]);
      case 'fs.stat':
        return this.stat(args[0]);
      case 'fs.exists':
        return this.exists(args[0]);
      case 'fs.readText':
        return this.readText(args[0]);
      case 'fs.readJSON':
        return JSON.parse(await this.readText(args[0]));
      case 'fs.readBase64':
        return this.readBase64(args[0]);
      case 'fs.writeText':
        return this.stageWrite(args[0], args[1]);
      case 'fs.writeJSON':
        return this.stageWrite(
          args[0],
          `${JSON.stringify(args[1], null, args[2]?.space ?? 2)}\n`,
        );
      case 'fs.appendText':
        return this.appendText(args[0], args[1]);
      case 'fs.replace':
        return this.replace(args[0], args[1], args[2], args[3]);
      case 'fs.copy':
        return this.stageWrite(args[1], await this.readText(args[0]));
      case 'fs.remove':
        return this.remove(args[0]);
      case 'fs.diff': {
        let path = args[0] == null ? undefined : realmPath(args[0]);
        return (await this.changes()).filter(
          (change) => path === undefined || change.path === path,
        );
      }
      case 'fs.lint':
        return this.lint(args[0]);
      case 'fs.readTranspiled':
        return this.readTranspiled(args[0]);
      case 'indexingErrors':
        return this.adapter.indexingErrors(this.realmUrl);
      case 'api.get':
        return this.apiRead('realm', 'Get', args[0], undefined, args[1]);
      case 'api.head':
        return this.apiRead('realm', 'Head', args[0], undefined, args[1]);
      case 'api.query':
        return this.apiRead('realm', 'Query', args[0], args[1], args[2]);
      case 'api.request':
        return this.apiRequest('realm', args[0], args[1], args[2]);
      case 'server.get':
        return this.apiRead('server', 'Get', args[0], undefined, args[1]);
      case 'server.head':
        return this.apiRead('server', 'Head', args[0], undefined, args[1]);
      case 'server.query':
        return this.apiRead('server', 'Query', args[0], args[1], args[2]);
      case 'server.request':
        return this.apiRequest('server', args[0], args[1], args[2]);
      case 'scoped.fs.list':
        return this.listFor(args[0]);
      case 'scoped.fs.glob':
        return this.glob(args[1], args[2], args[0]);
      case 'scoped.fs.grep':
        return this.grep(args[1], args[2], args[0]);
      case 'scoped.fs.stat':
        return this.stat(args[1], args[0]);
      case 'scoped.fs.exists':
        return this.exists(args[1], args[0]);
      case 'scoped.fs.readText':
        return this.readText(args[1], args[0]);
      case 'scoped.fs.readJSON':
        return JSON.parse(await this.readText(args[1], args[0]));
      case 'scoped.fs.readBase64':
        return this.readBase64(args[1], args[0]);
      case 'scoped.fs.lint':
        return this.lint(args[1], args[0]);
      case 'scoped.fs.readTranspiled':
        return this.readTranspiled(args[1], args[0]);
      case 'scoped.api.get':
        return this.apiRead(
          'realm',
          'Get',
          args[1],
          undefined,
          args[2],
          args[0],
        );
      case 'scoped.api.head':
        return this.apiRead(
          'realm',
          'Head',
          args[1],
          undefined,
          args[2],
          args[0],
        );
      case 'scoped.api.query':
        return this.apiRead(
          'realm',
          'Query',
          args[1],
          args[2],
          args[3],
          args[0],
        );
      case 'scoped.api.request':
        return this.apiRequest(
          'realm',
          args[1],
          args[2],
          args[3],
          args[0],
          args[4] === true,
        );
      case 'scoped.indexingErrors':
        return this.adapter.indexingErrors(
          await this.authorizeReadableRealm(args[0]),
        );
      case 'search':
        return this.search(args[0], args[1]);
      case 'help':
        return {
          apiVersion: '2',
          features: {
            notebooks: true,
            activity: true,
            streamingActivity: true,
          },
          methods: [
            'realm.current',
            'realm.input',
            'realm.notebook',
            'realm.activity(messageOrDetails)',
            'realm.listRealms(options?)',
            'realm.search(query, options?)',
            'realm.bxl.evaluate(expression, input, options?)',
            'realm.bxl.jq(expression, input)',
            'realm.indexingErrors()',
            'realm.api.get(path, options?)',
            'realm.api.head(path, options?)',
            'realm.api.query(path, body, options?)',
            'realm.api.request(method, path, options?)',
            'realm.server.get(path, options?)',
            'realm.server.head(path, options?)',
            'realm.server.query(path, body, options?)',
            'realm.server.request(method, path, options?)',
            'realm.open(url, options?).fs.* (read-only)',
            'realm.open(url).search(query)',
            'realm.open(url).api.get(path, options?)',
            'realm.open(url).api.head(path, options?)',
            'realm.open(url).api.query(path, body, options?)',
            'realm.open(url).api.request(method, path, options?) (read-only)',
            'realm.open(url, { write: true }).api.request(method, path, options?) (commit + write grant)',
            'realm.open(url).indexingErrors()',
            'realm.fs.list()',
            'realm.fs.glob(pattern, options?)',
            'realm.fs.grep(pattern, { glob?, files?, ignore?, contextLines?, maxMatches? })',
            'realm.fs.stat(path)',
            'realm.fs.exists(path)',
            'realm.fs.readText(path)',
            'realm.fs.readJSON(path)',
            'realm.fs.readBase64(path)',
            'realm.fs.writeText(path, content)',
            'realm.fs.writeJSON(path, value, options?)',
            'realm.fs.appendText(path, content)',
            'realm.fs.replace(path, search, replacement, options?)',
            'realm.fs.copy(from, to)',
            'realm.fs.remove(path)',
            'realm.fs.diff(path?)',
            'realm.fs.lint(path)',
            'realm.fs.readTranspiled(path)',
          ],
        };
      default:
        throw new RealmRunnerError(
          'CAPABILITY_DENIED',
          `Unknown Realm capability operation: ${operation}`,
        );
    }
  }

  async changes() {
    let changes = [];
    for (let [filePath, after] of this.overlay) {
      let before = this.baseline.get(filePath);
      if (before === after) continue;
      if (before === undefined && after === REMOVED) continue;
      let diff = createTwoFilesPatch(
        before === undefined ? '/dev/null' : `a/${filePath}`,
        after === REMOVED ? '/dev/null' : `b/${filePath}`,
        before ?? '',
        after === REMOVED ? '' : after,
        '',
        '',
        { context: 3 },
      );
      if (byteLength(diff) > this.limits.diffBytes) {
        diff = `${diff.slice(0, this.limits.diffBytes)}\n... diff truncated ...\n`;
      }
      changes.push({
        operation:
          after === REMOVED
            ? 'remove'
            : before === undefined
              ? 'create'
              : 'update',
        path: filePath,
        beforeHash: before === undefined ? null : await sha256(before),
        afterHash: after === REMOVED ? null : await sha256(after),
        diff,
      });
    }
    return changes;
  }

  async finish() {
    let changes = await this.changes();
    if (this.mode === 'commit' && changes.length > 0) {
      for (let change of changes) {
        let latest = await this.adapter.readText(this.realmUrl, change.path);
        if (latest !== this.baseline.get(change.path)) {
          throw new RealmRunnerError(
            'WRITE_CONFLICT',
            `Realm file changed while the program was running: ${change.path}`,
          );
        }
      }
      await this.adapter.atomicWrite(
        this.realmUrl,
        changes.map((change) => ({
          operation: change.operation,
          path: change.path,
          content:
            this.overlay.get(change.path) === REMOVED
              ? undefined
              : this.overlay.get(change.path),
          exists: this.baseline.get(change.path) !== undefined,
        })),
      );
    }
    return {
      changes,
      effects: this.effects.map((effect) => ({ ...effect })),
      logs: this.logs,
      stats: { ...this.stats },
    };
  }
}

export { DEFAULT_LIMITS };
