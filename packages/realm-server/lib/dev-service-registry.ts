import { execSync, spawn } from 'child_process';
import { writeFileSync, renameSync, unlinkSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { logger } from '@cardstack/runtime-common';
import type { AddressInfo, Server } from 'net';
import yaml from 'yaml';

import { sanitizeSlug } from '../../../scripts/env-slug.js';

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
  _traefikDir = resolve(import.meta.dirname, '..', '..', '..', 'traefik', 'dynamic');
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

export function serviceHostname(serviceName: string, env?: string): string {
  let slug = env ?? getEnvironmentSlug();
  return `${serviceName}.${slug}.${DOMAIN}`;
}

export function serviceURL(serviceName: string, env?: string): string {
  // Traefik terminates TLS on :443 for every `*.<slug>.localhost`
  // hostname using the mkcert leaf mounted via docker-compose
  // (traefik/dynamic/tls.yml). HTTP requests on :80 308-redirect to
  // https — see `registerService` below.
  return `https://${serviceHostname(serviceName, env)}`;
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
  opts?: { env?: string; wildcardSubdomains?: boolean; http2?: boolean },
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

  // Two routers per service. `websecure` (port 443) terminates the
  // browser's TLS at Traefik using the mkcert leaf in
  // traefik/dynamic/tls.yml. The `-http` router on :80 308-redirects to
  // https so a stale http:// link still works.
  //
  // The upstream scheme depends on the service. worker / prerender / vite
  // serve plain HTTP on their dynamic port, so Traefik proxies plain HTTP
  // to them. The realm-server (http2: true) terminates TLS and serves
  // HTTP/2 — HTTP/2 is a system invariant — so Traefik re-originates an
  // HTTPS connection to it and negotiates h2 via ALPN. The mkcert leaf's
  // SAN covers `*.localhost`, not the `host.docker.internal` address
  // Traefik dials, so the h2 upstream uses a serversTransport with
  // insecureSkipVerify (a localhost-only dev backend).
  let redirectMiddleware = `${routerKey}-https-redirect`;
  let upstreamScheme = opts?.http2 ? 'https' : 'http';
  let serversTransportKey = `${routerKey}-h2`;
  let loadBalancer: any = {
    servers: [
      { url: `${upstreamScheme}://host.docker.internal:${actualPort}` },
    ],
  };
  if (opts?.http2) {
    loadBalancer.serversTransport = serversTransportKey;
  }
  let config: any = {
    http: {
      routers: {
        [routerKey]: {
          rule,
          service: routerKey,
          entryPoints: ['websecure'],
          tls: {},
        },
        [`${routerKey}-http`]: {
          rule,
          entryPoints: ['web'],
          middlewares: [redirectMiddleware],
          service: routerKey,
        },
      },
      middlewares: {
        [redirectMiddleware]: {
          redirectScheme: {
            scheme: 'https',
            permanent: true,
          },
        },
      },
      services: {
        [routerKey]: { loadBalancer },
      },
      ...(opts?.http2
        ? {
            serversTransports: {
              [serversTransportKey]: { insecureSkipVerify: true },
            },
          }
        : {}),
    },
  };

  atomicWrite(configPath, yaml.stringify(config));
  log.info(
    `Registered ${serviceName} at ${hostname} -> localhost:${actualPort}`,
  );
  kickTraefikIfNeeded();
}

// Traefik's file-provider `watch: true` uses inotify, which Docker
// Desktop on macOS doesn't propagate through bind mounts — Traefik
// keeps serving the previous file's contents and the new dynamic port
// never reaches the proxy (502 Bad Gateway). Traefik v3 has no
// file-provider polling option, so the workaround is to bounce the
// container after each registration. Linux's inotify works fine, so
// the kick is a no-op there. Concurrent restarts are serialized by
// the Docker daemon; the last one to finish has the latest config.
function kickTraefikIfNeeded(): void {
  if (process.platform !== 'darwin') return;
  let child = spawn('docker', ['restart', 'boxel-traefik'], {
    // Fully detached so the realm-server process can exit without
    // waiting on docker — readiness probes through Traefik already
    // have retry behavior to ride out the brief downtime.
    stdio: 'ignore',
    detached: true,
  });
  child.on('error', (e) =>
    log.warn(`Could not restart Traefik (file-watcher kick): ${e.message}`),
  );
  child.unref();
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
