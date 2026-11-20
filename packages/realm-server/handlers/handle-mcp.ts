// A placeholder MCP endpoint at `/mcp`. It exists only to prove that an OAuth
// access token reaches a resource, for tests and the staging run with an MCP
// client such as MCP Inspector. The MCP server replaces it.
//
// It answers the MCP basics and nothing more: `initialize`, `ping` and
// `tools/list`, which lists no tools. It is stateless, with plain JSON
// responses: no session, and no event stream. A body over
// `MCP_MAX_BODY_BYTES` is answered `413` unread. The resource's controller
// runs first (`lib/oauth-provider/resource.ts`), so only a request with a
// valid token for `/mcp` gets here. Its caller, with the scopes the token
// holds, is `ctxt.state.oauthCaller`; the token itself never gets here
// (ADR 021 §1.5).
//
// Each tool names the scope it needs where it is defined, and a tool call is
// admitted only when the caller's scopes include it (ADR 021 §1.3). There are
// no tools, so every tool call is refused.

import type Koa from 'koa';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import {
  fetchRequestFromContext,
  setRequestText,
} from '../middleware/index.ts';

export const MCP_SERVER_NAME = 'boxel-mcp-placeholder';

// The largest body `/mcp` reads. Any account can get a token, so a body is
// refused as soon as its declared length or the bytes received pass this,
// and is never held whole. The placeholder's requests are a few hundred bytes.
export const MCP_MAX_BODY_BYTES = 64 * 1024;

class BodyTooLarge extends Error {}

function placeholderServer(): Server {
  let server = new Server(
    { name: MCP_SERVER_NAME, version: '0.0.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Unknown tool: ${request.params.name}`,
    );
  });
  return server;
}

// `POST /mcp`. A new server and transport answer each request, since nothing
// is kept between requests.
export async function handleMCP(ctxt: Koa.Context): Promise<void> {
  try {
    setRequestText(ctxt, await readBody(ctxt));
  } catch (error) {
    if (error instanceof BodyTooLarge) {
      return jsonRPCError(
        ctxt,
        413,
        `The request body is larger than ${MCP_MAX_BODY_BYTES} bytes.`,
      );
    }
    throw error;
  }
  let server = placeholderServer();
  let transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    let response = await transport.handleRequest(
      await fetchRequestFromContext(ctxt),
    );
    // The body is set before the status, and an empty one as `null`: Koa
    // would otherwise write its status message as the body of a response
    // that has none, such as the `202` that answers notifications.
    let body = await response.text();
    ctxt.body = body || null;
    ctxt.status = response.status;
    // Koa sets the length from the body it writes.
    response.headers.forEach((value, name) => {
      if (name !== 'content-length') {
        ctxt.set(name, value);
      }
    });
  } finally {
    await transport.close();
    await server.close();
  }
}

// `GET` and `DELETE /mcp`. A stateless server opens no event stream and has no
// session to end, so both answer `405` (MCP's Streamable HTTP transport allows
// this). Neither serves anything, so neither looks at a token.
export async function handleMCPMethodNotAllowed(
  ctxt: Koa.Context,
): Promise<void> {
  ctxt.set('Allow', 'POST');
  jsonRPCError(ctxt, 405, 'Method not allowed.');
}

async function readBody(ctxt: Koa.Context): Promise<string> {
  let declared = Number(ctxt.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MCP_MAX_BODY_BYTES) {
    throw new BodyTooLarge();
  }
  let chunks: Buffer[] = [];
  let received = 0;
  for await (let chunk of ctxt.req) {
    let buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.length;
    if (received > MCP_MAX_BODY_BYTES) {
      throw new BodyTooLarge();
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// An error answered over HTTP before any JSON-RPC request is read, shaped as
// the MCP SDK's transport shapes its own.
function jsonRPCError(ctxt: Koa.Context, status: number, message: string) {
  ctxt.status = status;
  ctxt.body = { jsonrpc: '2.0', error: { code: -32000, message }, id: null };
}
