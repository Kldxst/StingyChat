import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { normalizeMcpToolName } from './pluginAdapters';

export interface ConnectedMcp {
  serverName: string;
  tools: Array<{ name: string; originalName: string; description?: string }>;
  close: () => Promise<void>;
}

export async function connectHttpMcp(serverName: string, endpoint: string): Promise<ConnectedMcp> {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('HTTP MCP 必须使用无内嵌凭据的 HTTPS 地址');
  const client = new Client({ name: 'stingychat', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(url);
  await client.connect(transport);
  try {
    const result = await client.listTools();
    const tools = await Promise.all(result.tools.map(async (tool) => ({
      name: await normalizeMcpToolName(serverName, tool.name),
      originalName: tool.name,
      description: tool.description,
    })));
    return { serverName, tools, close: () => client.close() };
  } catch (error) {
    await client.close();
    throw error;
  }
}
