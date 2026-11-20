// A placeholder MCP endpoint at `/mcp`. It exists only to prove that an OAuth
// access token reaches a resource, for tests and the staging run with an MCP
// client such as MCP Inspector. The MCP server replaces it.
//
// It answers the MCP basics and nothing more: `initialize`, `ping` and
// `tools/list`, which lists no tools. It is stateless, with plain JSON
// responses: no session, and no event stream. The resource's controller runs
// first (`lib/oauth-provider/resource.ts`), so only a request with a valid
// token for `/mcp` gets here, as `ctxt.state.oauthCaller`.
//
// Each tool names the scope it needs where it is defined, and a tool call is
// admitted only when the token holds that scope (ADR 021 §1.3). There are no
// tools, so every tool call is refused.

import type Koa from 'koa';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { fetchRequestFromContext } from '../middleware/index.ts';

export const MCP_SERVER_NAME = 'boxel-mcp-placeholder';

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
    ctxt.status = response.status;
    // Koa sets the length from the body it writes.
    response.headers.forEach((value, name) => {
      if (name !== 'content-length') {
        ctxt.set(name, value);
      }
    });
    let body = await response.text();
    if (body) {
      ctxt.body = body;
    }
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
  ctxt.status = 405;
  ctxt.set('Allow', 'POST');
  ctxt.body = {
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null,
  };
}
