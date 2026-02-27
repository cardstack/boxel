import { execSync } from 'child_process';
import { writeFileSync, renameSync, unlinkSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { logger } from '@cardstack/runtime-common';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import yaml from 'yaml';

const log = logger('dev-service-registry');

const DOMAIN = 'lvh.me';

// Resolve traefik/dynamic dir relative to repo root
function traefikDynamicDir(): string {
  // Walk up from packages/realm-server to repo root
  return resolve(__dirname, '..', '..', '..', 'traefik', 'dynamic');
}

export function getBranchSlug(): string {
  if (process.env.BOXEL_BRANCH) {
    return sanitizeSlug(process.env.BOXEL_BRANCH);
  }
  try {
    let branch = execSync('git branch --show-current', {
      encoding: 'utf-8',
    }).trim();
    return sanitizeSlug(branch);
  } catch {
    return 'default';
  }
}

function sanitizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\//g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function serviceHostname(
  serviceName: string,
  branch?: string,
): string {
  let slug = branch ?? getBranchSlug();
  return `${serviceName}.${slug}.${DOMAIN}`;
}

export function serviceURL(serviceName: string, branch?: string): string {
  return `http://${serviceHostname(serviceName, branch)}`;
}

export function isBranchMode(): boolean {
  return !!process.env.BOXEL_BRANCH;
}

/**
 * Register a running HTTP server with Traefik by writing/merging a dynamic YAML config.
 * The config file is `traefik/dynamic/<branch>.yml` and contains routers + services
 * for all services in this branch.
 */
export function registerService(
  server: Server,
  serviceName: string,
  branch?: string,
): void {
  let slug = branch ?? getBranchSlug();
  let addr = server.address() as AddressInfo;
  if (!addr || typeof addr === 'string') {
    log.error(
      `Cannot register service ${serviceName}: server not bound to a port`,
    );
    return;
  }
  let actualPort = addr.port;
  log.info(
    `Registering service ${serviceName} (port ${actualPort}) for branch ${slug}`,
  );

  let configPath = join(traefikDynamicDir(), `${slug}.yml`);
  let config = loadExistingConfig(configPath);

  let routerKey = `${serviceName}-${slug}`;
  let serviceKey = `${serviceName}-${slug}`;
  let hostname = serviceHostname(serviceName, slug);

  if (!config.http) {
    config.http = {};
  }
  if (!config.http.routers) {
    config.http.routers = {};
  }
  if (!config.http.services) {
    config.http.services = {};
  }

  config.http.routers[routerKey] = {
    rule: `Host(\`${hostname}\`)`,
    service: serviceKey,
    entryPoints: ['web'],
  };

  config.http.services[serviceKey] = {
    loadBalancer: {
      servers: [{ url: `http://host.docker.internal:${actualPort}` }],
    },
  };

  atomicWrite(configPath, yaml.stringify(config));
  log.info(
    `Registered ${serviceName} at ${hostname} -> localhost:${actualPort}`,
  );
}

/**
 * Remove the branch's Traefik dynamic config file on shutdown.
 */
export function deregisterBranch(branch?: string): void {
  let slug = branch ?? getBranchSlug();
  let configPath = join(traefikDynamicDir(), `${slug}.yml`);
  try {
    unlinkSync(configPath);
    log.info(`Deregistered branch ${slug} from Traefik`);
  } catch (e: any) {
    if (e.code !== 'ENOENT') {
      log.error(`Failed to deregister branch ${slug}: ${e.message}`);
    }
  }
}

function loadExistingConfig(configPath: string): any {
  try {
    let content = readFileSync(configPath, 'utf-8');
    return yaml.parse(content) || {};
  } catch {
    return {};
  }
}

function atomicWrite(filePath: string, content: string): void {
  let tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, content, 'utf-8');
  renameSync(tmpPath, filePath);
}
