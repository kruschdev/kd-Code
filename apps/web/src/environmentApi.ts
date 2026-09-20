import type { EnvironmentId, EnvironmentApi } from "@t3tools/contracts";

import type { WsRpcClient } from "./rpc/wsRpcClient";
import { readEnvironmentConnection } from "./environments/runtime";
import { getOrCreateMcpClient } from "./mcpClient";

const environmentApiOverridesForTests = new Map<EnvironmentId, EnvironmentApi>();
const BRIDGE_URL = "http://localhost:3778";

async function dispatchToBridge(command: any): Promise<any> {
  try {
    if (command?.type === "thread.turn.start") {
      const prompt = command.message?.text || "";
      const res = await fetch(`${BRIDGE_URL}/api/harness/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: prompt,
          projectPath: command.bootstrap?.createThread?.worktreePath || undefined,
        }),
      });
      if (res.ok) {
        return await res.json();
      }
    } else if (command?.type === "thread.approval.respond") {
      const res = await fetch(`${BRIDGE_URL}/api/harness/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: command.threadId,
          diffId: command.requestId ? Number(command.requestId) : undefined,
        }),
      });
      if (res.ok) {
        return await res.json();
      }
    }
  } catch (err) {
    console.warn("[Bridge Dispatch] Error dispatching to bridge:", err);
  }
  return null;
}

async function callMcpTool<T>(name: string, args: any): Promise<T> {
  const mcpClient = await getOrCreateMcpClient("http://localhost:3773/mcp/sse");
  const result = await mcpClient.callTool({
    name,
    arguments: args
  });
  if (result.isError) {
    throw new Error(`MCP Tool Error: ${result.content[0].text}`);
  }
  return JSON.parse(result.content[0].text as string) as T;
}

export function createEnvironmentApi(rpcClient: WsRpcClient): EnvironmentApi {
  return {
    terminal: {
      open: async (input) => {
        try {
          return await callMcpTool("terminal_open", input);
        } catch (error) {
          console.warn("[MCP Fallback] terminal_open failed, falling back to RPC", error);
          return rpcClient.terminal.open(input as never);
        }
      },
      write: async (input) => {
        try {
          return await callMcpTool("terminal_write", input);
        } catch (error) {
          console.warn("[MCP Fallback] terminal_write failed, falling back to RPC", error);
          return rpcClient.terminal.write(input as never);
        }
      },
      resize: async (input) => {
        try {
          return await callMcpTool("terminal_resize", input);
        } catch (error) {
          console.warn("[MCP Fallback] terminal_resize failed, falling back to RPC", error);
          return rpcClient.terminal.resize(input as never);
        }
      },
      clear: async (input) => {
        try {
          return await callMcpTool("terminal_close", { terminalId: input.terminalId });
        } catch (error) {
          console.warn("[MCP Fallback] terminal_clear failed, falling back to RPC", error);
          return rpcClient.terminal.clear(input as never);
        }
      },
      restart: async (input) => {
        try {
          return rpcClient.terminal.restart(input as never);
        } catch (error) {
          return rpcClient.terminal.restart(input as never);
        }
      },
      close: async (input) => {
        try {
          return await callMcpTool("terminal_close", input);
        } catch (error) {
          console.warn("[MCP Fallback] terminal_close failed, falling back to RPC", error);
          return rpcClient.terminal.close(input as never);
        }
      },
      onEvent: (callback) => rpcClient.terminal.onEvent(callback),
    },
    projects: {
      searchEntries: async (input) => {
        try {
          return await callMcpTool("projects_search_entries", input);
        } catch (error) {
          console.warn("[MCP Fallback] searchEntries failed, falling back to RPC", error);
          return rpcClient.projects.searchEntries(input);
        }
      },
      writeFile: async (input) => {
        try {
          return await callMcpTool("projects_write_file", input);
        } catch (error) {
          console.warn("[MCP Fallback] writeFile failed, falling back to RPC", error);
          return rpcClient.projects.writeFile(input);
        }
      },
    },
    filesystem: {
      browse: async (input) => {
        try {
          return await callMcpTool("filesystem_browse", input);
        } catch (error) {
          console.warn("[MCP Fallback] browse failed, falling back to RPC", error);
          return rpcClient.filesystem.browse(input);
        }
      },
    },
    git: {
      pull: async (input) => {
        try {
          return await callMcpTool("git_pull", input);
        } catch (error) {
          console.warn("[MCP Fallback] git_pull failed, falling back to RPC", error);
          return rpcClient.git.pull(input);
        }
      },
      refreshStatus: async (input) => {
        try {
          return await callMcpTool("get_git_status", { cwd: input.cwd });
        } catch (error) {
          console.warn("[MCP Fallback] git_status failed, falling back to RPC", error);
          return rpcClient.git.refreshStatus(input);
        }
      },
      onStatus: (input, callback, options) => rpcClient.git.onStatus(input, callback, options),
      listBranches: async (input) => {
        try {
          return await callMcpTool("git_list_branches", input);
        } catch (error) {
          console.warn("[MCP Fallback] listBranches failed, falling back to RPC", error);
          return rpcClient.git.listBranches(input);
        }
      },
      createWorktree: async (input) => {
        try {
          return await callMcpTool("git_create_worktree", input);
        } catch (error) {
          console.warn("[MCP Fallback] createWorktree failed, falling back to RPC", error);
          return rpcClient.git.createWorktree(input);
        }
      },
      removeWorktree: async (input) => {
        try {
          return await callMcpTool("git_remove_worktree", input);
        } catch (error) {
          console.warn("[MCP Fallback] removeWorktree failed, falling back to RPC", error);
          return rpcClient.git.removeWorktree(input);
        }
      },
      createBranch: async (input) => {
        try {
          return await callMcpTool("git_create_branch", input);
        } catch (error) {
          console.warn("[MCP Fallback] createBranch failed, falling back to RPC", error);
          return rpcClient.git.createBranch(input);
        }
      },
      checkout: async (input) => {
        try {
          return await callMcpTool("git_checkout", input);
        } catch (error) {
          console.warn("[MCP Fallback] checkout failed, falling back to RPC", error);
          return rpcClient.git.checkout(input);
        }
      },
      init: (input) => rpcClient.git.init(input),
      resolvePullRequest: async (input) => {
        try {
          return await callMcpTool("git_resolve_pr", input);
        } catch (error) {
          console.warn("[MCP Fallback] resolvePR failed, falling back to RPC", error);
          return rpcClient.git.resolvePullRequest(input);
        }
      },
      preparePullRequestThread: (input) => rpcClient.git.preparePullRequestThread(input),
    },
    orchestration: {
      dispatchCommand: async (input) => {
        try {
          return await callMcpTool("orchestration_dispatch_command", { command: input });
        } catch (error) {
          const bridgeResult = await dispatchToBridge(input);
          if (bridgeResult) {
            return bridgeResult as never;
          }
          console.warn("[MCP Fallback] dispatchCommand failed, falling back to RPC", error);
          return rpcClient.orchestration.dispatchCommand(input);
        }
      },
      getTurnDiff: async (input) => {
        try {
          return await callMcpTool("orchestration_get_turn_diff", input);
        } catch (error) {
          try {
            const res = await fetch(`${BRIDGE_URL}/api/harness/diff?taskId=${encodeURIComponent((input as any).threadId || "")}`);
            if (res.ok) {
              const data = await res.json();
              if (data.diffs) {
                return data as never;
              }
            }
          } catch {}
          console.warn("[MCP Fallback] getTurnDiff failed, falling back to RPC", error);
          return rpcClient.orchestration.getTurnDiff(input);
        }
      },
      getFullThreadDiff: async (input) => {
        try {
          return await callMcpTool("orchestration_get_full_thread_diff", input);
        } catch (error) {
          try {
            const res = await fetch(`${BRIDGE_URL}/api/harness/diff?taskId=${encodeURIComponent((input as any).threadId || "")}`);
            if (res.ok) {
              const data = await res.json();
              if (data.diffs) {
                return data as never;
              }
            }
          } catch {}
          console.warn("[MCP Fallback] getFullThreadDiff failed, falling back to RPC", error);
          return rpcClient.orchestration.getFullThreadDiff(input);
        }
      },
      subscribeShell: (callback, options) =>
        rpcClient.orchestration.subscribeShell(callback, options),
      subscribeThread: (input, callback, options) =>
        rpcClient.orchestration.subscribeThread(input, callback, options),
    },
  };
}

export function readEnvironmentApi(environmentId: EnvironmentId): EnvironmentApi | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  if (!environmentId) {
    return undefined;
  }

  const overriddenApi = environmentApiOverridesForTests.get(environmentId);
  if (overriddenApi) {
    return overriddenApi;
  }

  const connection = readEnvironmentConnection(environmentId);
  return connection ? createEnvironmentApi(connection.client) : undefined;
}

export function ensureEnvironmentApi(environmentId: EnvironmentId): EnvironmentApi {
  const api = readEnvironmentApi(environmentId);
  if (!api) {
    throw new Error(`Environment API not found for environment ${environmentId}`);
  }
  return api;
}

export function __setEnvironmentApiOverrideForTests(
  environmentId: EnvironmentId,
  api: EnvironmentApi,
): void {
  environmentApiOverridesForTests.set(environmentId, api);
}

export function __resetEnvironmentApiOverridesForTests(): void {
  environmentApiOverridesForTests.clear();
}
