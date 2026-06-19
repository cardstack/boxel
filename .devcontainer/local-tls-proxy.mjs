// Local TLS shim for GitHub Codespaces.
//
// The realm server serves plain HTTP on :4201 and GitHub's edge terminates
// TLS for the *browser*. But in-codespace clients — the index worker and the
// prerender's headless Chrome — address the realm at its canonical
// https://<name>-4201.<domain> URL. Without help they'd reach it back out
// through the GitHub edge, which requires the port to be public (a manual
// step that can't be set from inside the codespace).
//
// Paired with an /etc/hosts entry mapping that hostname to 127.0.0.1, this
// shim terminates TLS on :443 and forwards to the realm on 127.0.0.1:4201, so
// those clients reach the realm entirely over loopback — no edge round-trip,
// no public port. It's the local equivalent of env-mode's Traefik. The
// browser is unaffected: it's external, uses real DNS, and still reaches the
// realm through GitHub's edge.
//
// Self-signed cert; in-codespace clients are configured to skip validation
// (worker: NODE_TLS_REJECT_UNAUTHORIZED=0; Chrome: --ignore-certificate-errors
// via PUPPETEER_CHROME_ARGS), since the connection is loopback-only.
import https from 'node:https';
import http from 'node:http';
import { readFileSync } from 'node:fs';

const PORT = Number(process.env.SHIM_PORT || 443);
const TARGET_PORT = Number(process.env.SHIM_TARGET_PORT || 4201);
const TARGET_HOST = process.env.SHIM_TARGET_HOST || '127.0.0.1';

const server = https.createServer(
  {
    cert: readFileSync(process.env.SHIM_CERT),
    key: readFileSync(process.env.SHIM_KEY),
  },
  (req, res) => {
    // Forward method, path+query, headers and body verbatim; the realm's
    // REALM_SERVER_ASSUME_HTTPS handling fixes up scheme/host from here.
    let upstream = http.request(
      {
        host: TARGET_HOST,
        port: TARGET_PORT,
        method: req.method,
        path: req.url,
        headers: req.headers,
      },
      (upRes) => {
        res.writeHead(upRes.statusCode || 502, upRes.headers);
        upRes.pipe(res);
      },
    );
    upstream.on('error', (err) => {
      if (!res.headersSent) res.writeHead(502);
      res.end(`local-tls-shim upstream error: ${err.message}`);
    });
    req.pipe(upstream);
  },
);

server.on('error', (err) => {
  console.error(`[local-tls-shim] fatal: ${err.message}`);
  process.exit(1);
});
server.listen(PORT, () => {
  console.log(
    `[local-tls-shim] listening :${PORT} -> ${TARGET_HOST}:${TARGET_PORT}`,
  );
});
