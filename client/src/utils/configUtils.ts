import { InspectorConfig } from "@/lib/configurationTypes";
// Removed unused import: import { DEFAULT_MCP_PROXY_LISTEN_PORT } from "@/lib/constants";

export const getMCPProxyAddress = (config: InspectorConfig): string => {
  const proxyFullAddress = config.MCP_PROXY_FULL_ADDRESS.value as string;
  if (proxyFullAddress) {
    return proxyFullAddress;
  }
  // Use the current window's port instead of the default internal port
  const port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
  return `${window.location.protocol}//${window.location.hostname}:${port}`;
};

export const getMCPServerRequestTimeout = (config: InspectorConfig): number => {
  return config.MCP_SERVER_REQUEST_TIMEOUT.value as number;
};

export const resetRequestTimeoutOnProgress = (
  config: InspectorConfig,
): boolean => {
  return config.MCP_REQUEST_TIMEOUT_RESET_ON_PROGRESS.value as boolean;
};

export const getMCPServerRequestMaxTotalTimeout = (
  config: InspectorConfig,
): number => {
  return config.MCP_REQUEST_MAX_TOTAL_TIMEOUT.value as number;
};
