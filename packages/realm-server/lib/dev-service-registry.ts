import { execSync } from 'child_process';
import { writeFileSync, renameSync, unlinkSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { logger } from '@cardstack/runtime-common';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import yaml from 'yaml';

const log = logger('dev-service-registry');

const DOMAIN = 'localhost';

// Resolve the traefik/dynamic dir that the running Traefik container watches.
// In a worktree the repo-relative path differs from the mounted path, so we
// ask Docker for the actual host mount when the container is running.
let _traefikDir: string | undefined;
function traefikDynamicDir(): string {
  if (_traefikDir) {
    return _traefikDir;
  }
  try {
    let mounted = execSync(
      `docker inspect boxel-traefik --format '{{range .Mounts}}{{if eq .Destination "/etc/traefik/dynamic"}}{{.Source}}{{end}}{{end}}'`,
      { encoding: 'utf-8' },
    ).trim();
    if (mounted) {
      _traefikDir = mounted;
      return _traefikDir;
    }
  } catch {
    // Traefik not running — fall back to repo-relative path
  }
  _traefikDir = resolve(__dirname, '..', '..', '..', 'traefik', 'dynamic');
  return _traefikDir;
}

export function getEnvironmentSlug(): string {
  if (process.env.BOXEL_ENVIRONMENT) {
    return sanitizeSlug(process.env.BOXEL_ENVIRONMENT);
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

export function serviceHostname(serviceName: string, env?: string): string {
  let slug = env ?? getEnvironmentSlug();
  return `${serviceName}.${slug}.${DOMAIN}`;
}

export function serviceURL(serviceName: string, env?: string): string {
  return `http://${serviceHostname(serviceName, env)}`;
}

export function isEnvironmentMode(): boolean {
  return !!process.env.BOXEL_ENVIRONMENT;
}

/**
 * Register a running HTTP server with Traefik by writing a per-service
 * dynamic YAML config file: `traefik/dynamic/<slug>-<service>.yml`.
 *
 * Each service gets its own file so services can register/deregister
 * independently without interfering with each other.
 */
export function registerService(
  server: Server,
  serviceName: string,
  opts?: { env?: string; wildcardSubdomains?: boolean },
): void {
  let slug = opts?.env ?? getEnvironmentSlug();
  let addr = server.address() as AddressInfo;
  if (!addr || typeof addr === 'string') {
    log.error(
      `Cannot register service ${serviceName}: server not bound to a port`,
    );
    return;
  }
  let actualPort = addr.port;
  log.info(
    `Registering service ${serviceName} (port ${actualPort}) for environment ${slug}`,
  );

  let configPath = join(traefikDynamicDir(), `${slug}-${serviceName}.yml`);
  let routerKey = `${serviceName}-${slug}`;
  let hostname = serviceHostname(serviceName, slug);

  // Build the Traefik Host rule. When wildcardSubdomains is true, also match
  // any subdomain of the service hostname (e.g. *.realm-server.<slug>.localhost)
  // so that published realm subdomains are routed to the same server.
  let escapedHostname = hostname.replace(/\./g, '\\.');
  let rule = opts?.wildcardSubdomains
    ? `Host(\`${hostname}\`) || HostRegexp(\`^.+\\.${escapedHostname}$\`)`
    : `Host(\`${hostname}\`)`;

  let config: any = {
    http: {
      routers: {
        [routerKey]: {
          rule,
          service: routerKey,
          entryPoints: ['web'],
        },
      },
      services: {
        [routerKey]: {
          loadBalancer: {
            servers: [{ url: `http://host.docker.internal:${actualPort}` }],
          },
        },
      },
    },
  };

  atomicWrite(configPath, yaml.stringify(config));
  log.info(
    `Registered ${serviceName} at ${hostname} -> localhost:${actualPort}`,
  );
}

/**
 * Remove a single service's Traefik config file on shutdown.
 */
export function deregisterService(serviceName: string, env?: string): void {
  let slug = env ?? getEnvironmentSlug();
  let configPath = join(traefikDynamicDir(), `${slug}-${serviceName}.yml`);
  try {
    unlinkSync(configPath);
    log.info(
      `Deregistered ${serviceName} for environment ${slug} from Traefik`,
    );
  } catch (e: any) {
    if (e.code !== 'ENOENT') {
      log.error(
        `Failed to deregister ${serviceName} for environment ${slug}: ${e.message}`,
      );
    }
  }
}

/**
 * Remove all Traefik dynamic config files for an environment on full shutdown.
 */
export function deregisterEnvironment(env?: string): void {
  let slug = env ?? getEnvironmentSlug();
  let dir = traefikDynamicDir();
  let prefix = `${slug}-`;
  try {
    let files = readdirSync(dir);
    let removed = 0;
    for (let file of files) {
      if (file.startsWith(prefix) && file.endsWith('.yml')) {
        try {
          unlinkSync(join(dir, file));
          removed++;
        } catch (e: any) {
          if (e.code !== 'ENOENT') {
            log.error(`Failed to remove ${file}: ${e.message}`);
          }
        }
      }
    }
    if (removed > 0) {
      log.info(
        `Deregistered environment ${slug} from Traefik (${removed} service(s))`,
      );
    }
  } catch (e: any) {
    log.error(`Failed to deregister environment ${slug}: ${e.message}`);
  }
}

function atomicWrite(filePath: string, content: string): void {
  let tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, content, 'utf-8');
  renameSync(tmpPath, filePath);
}
