import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  SSEClientTransport,
  SseError,
} from "@modelcontextprotocol/sdk/client/sse.js";
import { 
    StreamableHttpClientTransport as StreamableHttpTransport,
    StreamableHttpError 
} from "../transports/StreamableHttpTransport"; // Corrected path

import {
  ClientNotification,
  ClientRequest,
  CreateMessageRequestSchema,
  ListRootsRequestSchema,
  ResourceUpdatedNotificationSchema,
  LoggingMessageNotificationSchema,
  Request,
  Result,
  ServerCapabilities,
  PromptReference,
  ResourceReference,
  McpError,
  CompleteResultSchema,
  ErrorCode,
  CancelledNotificationSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
  PromptListChangedNotificationSchema,
  Progress,
} from "@modelcontextprotocol/sdk/types.js";
import { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";
import { ConnectionStatus, SESSION_KEYS } from "../constants";
import { Notification, StdErrNotificationSchema } from "../notificationTypes";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { authProvider } from "../auth";
import packageJson from "../../../package.json";
import {
  getMCPProxyAddress,
  getMCPServerRequestMaxTotalTimeout,
  resetRequestTimeoutOnProgress,
} from "@/utils/configUtils";
import { getMCPServerRequestTimeout } from "@/utils/configUtils";
import { InspectorConfig } from "../configurationTypes";


interface UseConnectionOptions {
  transportType: "stdio" | "sse" | "streamableHttp"; // Added streamableHttp
  command: string;
  args: string;
  sseUrl: string; // Used as base URL for streamableHttp or target for SSE proxy
  env: Record<string, string>;
  bearerToken?: string;
  config: InspectorConfig;
  onNotification?: (notification: Notification) => void;
  onStdErrNotification?: (notification: Notification) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onPendingRequest?: (request: any, resolve: any, reject: any) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getRoots?: () => any[];
}

export function useConnection({
  transportType,
  command,
  args,
  sseUrl,
  env,
  bearerToken,
  config,
  onNotification,
  onStdErrNotification,
  onPendingRequest,
  getRoots,
}: UseConnectionOptions) {
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");
  const { toast } = useToast();
  const [serverCapabilities, setServerCapabilities] =
    useState<ServerCapabilities | null>(null);
  const [mcpClient, setMcpClient] = useState<Client | null>(null);
  const [requestHistory, setRequestHistory] = useState<
    { request: string; response?: string }[]
  >([]);
  const [completionsSupported, setCompletionsSupported] = useState(true);

  const pushHistory = (request: object, response?: object) => {
    setRequestHistory((prev) => [
      ...prev,
      {
        request: JSON.stringify(request),
        response: response !== undefined ? JSON.stringify(response) : undefined,
      },
    ]);
  };

  const makeRequest = async <T extends z.ZodType>(
    request: ClientRequest,
    schema: T,
    options?: RequestOptions & { suppressToast?: boolean },
  ): Promise<z.output<T>> => {
    if (!mcpClient) {
      throw new Error("MCP client not connected");
    }
    try {
      const abortController = new AbortController();

      // prepare MCP Client request options
      const mcpRequestOptions: RequestOptions = {
        signal: options?.signal ?? abortController.signal,
        resetTimeoutOnProgress:
          options?.resetTimeoutOnProgress ??
          resetRequestTimeoutOnProgress(config),
        timeout: options?.timeout ?? getMCPServerRequestTimeout(config),
        maxTotalTimeout:
          options?.maxTotalTimeout ??
          getMCPServerRequestMaxTotalTimeout(config),
      };

      // If progress notifications are enabled, add an onprogress hook to the MCP Client request options
      // This is required by SDK to reset the timeout on progress notifications
      if (mcpRequestOptions.resetTimeoutOnProgress) {
        mcpRequestOptions.onprogress = (params: Progress) => {
          // Add progress notification to `Server Notification` window in the UI
          if (onNotification) {
            onNotification({
              method: "notification/progress",
              params,
            });
          }
        };
      }

      let response;
      try {
        response = await mcpClient.request(request, schema, mcpRequestOptions);

        pushHistory(request, response);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        pushHistory(request, { error: errorMessage });
        throw error;
      }

      return response;
    } catch (e: unknown) {
      if (!options?.suppressToast) {
        const errorString = (e as Error).message ?? String(e);
        toast({
          title: "Error",
          description: errorString,
          variant: "destructive",
        });
      }
      throw e;
    }
  };

  const handleCompletion = async (
    ref: ResourceReference | PromptReference,
    argName: string,
    value: string,
    signal?: AbortSignal,
  ): Promise<string[]> => {
    if (!mcpClient || !completionsSupported) {
      return [];
    }

    const request: ClientRequest = {
      method: "completion/complete",
      params: {
        argument: {
          name: argName,
          value,
        },
        ref,
      },
    };

    try {
      const response = await makeRequest(request, CompleteResultSchema, {
        signal,
        suppressToast: true,
      });
      return response?.completion.values || [];
    } catch (e: unknown) {
      // Disable completions silently if the server doesn't support them.
      // See https://github.com/modelcontextprotocol/specification/discussions/122
      if (e instanceof McpError && e.code === ErrorCode.MethodNotFound) {
        setCompletionsSupported(false);
        return [];
      }

      // Unexpected errors - show toast and rethrow
      toast({
        title: "Error",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
      throw e;
    }
  };

  const sendNotification = async (notification: ClientNotification) => {
    if (!mcpClient) {
      const error = new Error("MCP client not connected");
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
      throw error;
    }

    try {
      await mcpClient.notification(notification);
      // Log successful notifications
      pushHistory(notification);
    } catch (e: unknown) {
      if (e instanceof McpError) {
        // Log MCP protocol errors
        pushHistory(notification, { error: e.message });
      }
      toast({
        title: "Error",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
      throw e;
    }
  };

  const checkProxyHealth = async () => {
    try {
      const proxyHealthUrl = new URL(`${getMCPProxyAddress(config)}/health`);
      console.info("proxyHealthUrl", proxyHealthUrl);
      const proxyHealthResponse = await fetch(proxyHealthUrl);
      console.info("proxyHealthResponse", proxyHealthResponse);
      const proxyHealth = await proxyHealthResponse.json();
      console.info("proxyHealth", proxyHealth);
      if (proxyHealth?.status !== "ok") {
        throw new Error("MCP Proxy Server is not healthy");
      }
    } catch (e) {
      console.error("Couldn't connect to MCP Proxy Server", e);
      throw e;
    }
  };

  const handleAuthError = async (error: unknown) => {
    // This function might need adjustment if StreamableHttpTransport handles auth differently
    if ((error instanceof SseError || error instanceof StreamableHttpError) && error.code === 401) {
      if (SESSION_KEYS.SERVER_URL != sseUrl) {
          authProvider.clear();
      }
      sessionStorage.setItem(SESSION_KEYS.SERVER_URL, sseUrl);

      const result = await auth(authProvider, { serverUrl: sseUrl });
      return result === "AUTHORIZED";
    }

    return false;
  };

  const connect = async (_e?: unknown, retryCount: number = 0) => {
    const client = new Client<Request, Notification, Result>(
      {
        name: "mcp-inspector",
        version: packageJson.version,
      },
      {
        capabilities: {
          sampling: {},
          roots: {
            listChanged: true,
          },
        },
      },
    );

    // Check proxy health only if not using direct streamableHttp
    if (transportType !== "streamableHttp") {
      try {
        await checkProxyHealth();
      } catch {
        setConnectionStatus("error-connecting-to-proxy");
        return;
      }
    }

    let clientTransport; // Declare transport variable
    const headers: HeadersInit = {};
    // Use manually provided bearer token if available, otherwise use OAuth tokens
    const token = bearerToken || (await authProvider.tokens())?.access_token;
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    // Instantiate the correct transport based on type
    if (transportType === "streamableHttp") {
      // Connect directly using StreamableHttpTransport
      // Assuming sseUrl is the base URL for the streamable HTTP server
      try {
        // Note: Constructor might need options like headers depending on implementation
        clientTransport = new StreamableHttpTransport(new URL(sseUrl), { headers });
      } catch (err) {
        console.error("Failed to instantiate StreamableHttpTransport:", err);
        setConnectionStatus("error");
        return;
      }
    } else {
      // Connect via the proxy for stdio or standard sse
      const mcpProxyServerUrl = new URL(`${getMCPProxyAddress(config)}/sse`);
      mcpProxyServerUrl.searchParams.append("transportType", transportType);
      if (transportType === "stdio") {
        mcpProxyServerUrl.searchParams.append("command", command);
        mcpProxyServerUrl.searchParams.append("args", args);
        mcpProxyServerUrl.searchParams.append("env", JSON.stringify(env));
      } else { // sse
        mcpProxyServerUrl.searchParams.append("url", sseUrl);
      }

      clientTransport = new SSEClientTransport(mcpProxyServerUrl, {
        eventSourceInit: {
          fetch: (url, init) => fetch(url, { ...init, headers }),
        },
        requestInit: {
          headers,
        },
      });
    }

    // Setup notification handlers
    if (onNotification) {
      [
        CancelledNotificationSchema,
        LoggingMessageNotificationSchema,
        ResourceUpdatedNotificationSchema,
        ResourceListChangedNotificationSchema,
        ToolListChangedNotificationSchema,
        PromptListChangedNotificationSchema,
      ].forEach((notificationSchema) => {
        client.setNotificationHandler(notificationSchema, onNotification);
      });

      client.fallbackNotificationHandler = (
        notification: Notification,
      ): Promise<void> => {
        onNotification(notification);
        return Promise.resolve();
      };
    }

    if (onStdErrNotification) {
      client.setNotificationHandler(
        StdErrNotificationSchema,
        onStdErrNotification,
      );
    }

    // Attempt to connect
    try {
      await client.connect(clientTransport);
    } catch (error) {
      console.error(
        `Failed to connect to MCP Server:`,
        error,
      );
      // Handle auth errors specifically for SSE via proxy
      if (true || (transportType !== 'streamableHttp')) {
        const shouldRetry = await handleAuthError(error);
        if (shouldRetry) {
          return connect(undefined, retryCount + 1);
        }

        if ((error instanceof SseError || error instanceof StreamableHttpError) && error.code === 401) {
          // Don't set error state if we're about to redirect for auth
          return;
        }
      }
      // For streamableHttp or unhandled SSE errors, set error state
      setConnectionStatus("error");
      return; // Stop execution after setting error state
    }

    // Post-connection setup
    try {
      const capabilities = client.getServerCapabilities();
      setServerCapabilities(capabilities ?? null);
      setCompletionsSupported(true); // Reset completions support on new connection

      if (onPendingRequest) {
        client.setRequestHandler(CreateMessageRequestSchema, (request) => {
          return new Promise((resolve, reject) => {
            onPendingRequest(request, resolve, reject);
          });
        });
      }

      if (getRoots) {
        client.setRequestHandler(ListRootsRequestSchema, async () => {
          return { roots: getRoots() };
        });
      }

      setMcpClient(client);
      setConnectionStatus("connected");
    } catch (e) {
      console.error("Error during post-connection setup:", e);
      setConnectionStatus("error");
      await client.close(); // Attempt to clean up client
      setMcpClient(null);
    }
  };

  const disconnect = async () => {
    await mcpClient?.close();
    setMcpClient(null);
    setConnectionStatus("disconnected");
    setCompletionsSupported(false);
    setServerCapabilities(null);
  };

  return {
    connectionStatus,
    serverCapabilities,
    mcpClient,
    requestHistory,
    makeRequest,
    sendNotification,
    handleCompletion,
    completionsSupported,
    connect,
    disconnect,
  };
}
