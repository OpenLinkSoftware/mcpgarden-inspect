import { InspectorConfig } from "@/lib/configurationTypes";
// Removed unused import: import { DEFAULT_MCP_PROXY_LISTEN_PORT } from "@/lib/constants";

export const getMCPProxyAddress = (config: InspectorConfig): string => {
  try {
    // If a full proxy address is explicitly configured, use it
    const proxyFullAddress = config.MCP_PROXY_FULL_ADDRESS.value as string;
    if (proxyFullAddress && proxyFullAddress.trim()) {
      console.log(`Using configured proxy address: ${proxyFullAddress}`);
      return proxyFullAddress;
    }

    // Otherwise, derive it from the current window location
    const port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');
    const derivedAddress = `${window.location.protocol}//${window.location.hostname}:${port}`;
    console.log(`Using derived proxy address: ${derivedAddress}`);
    return derivedAddress;
  } catch (error) {
    console.error("Error in getMCPProxyAddress:", error);
    // Fallback to a safe default based on the current hostname
    const fallbackAddress = `${window.location.protocol}//${window.location.hostname}`;
    console.log(`Using fallback proxy address: ${fallbackAddress}`);
    return fallbackAddress;
  }
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
