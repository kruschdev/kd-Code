import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

// Global cache of active MCP clients
const clients: Map<string, Client> = new Map();

export interface McpConnectionStatus {
  url: string;
  connected: boolean;
  capabilities: any;
}

/**
 * Connect to an MCP Server using Server-Sent Events (SSE).
 * If a connection to this URL already exists, it returns the existing client.
 */
export async function getOrCreateMcpClient(url: string): Promise<Client> {
  if (clients.has(url)) {
    return clients.get(url)!;
  }

  // The URL parameter here is expected to be the SSE endpoint, e.g. "http://localhost:18888/mcp/sse"
  const transport = new SSEClientTransport(new URL(url));
  const client = new Client(
    {
      name: "krusch-ide",
      version: "1.0.0",
    },
    {
      capabilities: {},
    }
  );

  // Keep track of connection lifecycle
  transport.onclose = () => {
    console.log(`[MCP] Connection closed: ${url}`);
    clients.delete(url);
  };
  
  transport.onerror = (error) => {
    console.error(`[MCP] Transport error for ${url}:`, error);
  };

  await client.connect(transport);
  console.log(`[MCP] Connected successfully to ${url}`);
  
  clients.set(url, client);
  return client;
}

/**
 * Returns the active clients and their connection status.
 */
export function getMcpConnectionStatuses(): McpConnectionStatus[] {
  return Array.from(clients.entries()).map(([url, client]) => {
    return {
      url,
      connected: true, // If it's in the map, it's connected (due to onclose cleanup)
      capabilities: client.getServerCapabilities(),
    };
  });
}

/**
 * Helper to fetch all tools across all active MCP servers.
 * In a Universal UI, you aggregate tools from all connected nodes.
 */
export async function getAggregatedMcpTools() {
  const tools = [];
  for (const [url, client] of clients.entries()) {
    try {
      const result = await client.listTools();
      tools.push(...(result.tools.map(t => ({ ...t, serverUrl: url }))));
    } catch (err) {
      console.warn(`[MCP] Failed to list tools from ${url}`, err);
    }
  }
  return tools;
}
