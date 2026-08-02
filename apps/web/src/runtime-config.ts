export interface RuntimeConfig {
  mode: 'MOCK' | 'REAL';
  region?: string;
  userPoolId?: string;
  userPoolClientId?: string;
  cognitoDomain?: string;
  redirectUri?: string;
  plannerApiUrl?: string;
}

declare global {
  interface Window {
    __SMART_REPORT_CONFIG__?: RuntimeConfig;
  }
}

export const runtimeConfig: RuntimeConfig = window.__SMART_REPORT_CONFIG__ ?? {
  mode: 'MOCK',
};

export function isCognitoConfigured(config: RuntimeConfig = runtimeConfig): boolean {
  return Boolean(config.userPoolClientId && config.cognitoDomain && config.redirectUri);
}

export function isRealPlannerConfigured(config: RuntimeConfig = runtimeConfig): boolean {
  return config.mode === 'REAL' && Boolean(config.plannerApiUrl);
}
