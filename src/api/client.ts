// Path: archon-cli/src/api/client.ts
// Base HTTP client with authentication

import https from 'https';
import { getActiveProfile } from '../config/index.js';
import { getValidToken } from '../config/tokens.js';

// Create an HTTPS agent that ignores certificate errors
const insecureAgent = new https.Agent({
  rejectUnauthorized: false
});

/**
 * Get fetch options for insecure mode
 */
function getFetchOptions(insecure?: boolean): RequestInit {
  if (insecure) {
    return {
      // @ts-expect-error Node.js specific option
      agent: insecureAgent
    };
  }
  return {};
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  authenticated?: boolean;
}

export interface ApiError {
  status: number;
  message: string;
  error?: string;
  details?: Record<string, unknown>;
}

/**
 * API client for making authenticated requests
 */
export class ApiClient {
  private baseUrl: string;
  private profileName?: string;

  constructor(profileName?: string) {
    this.profileName = profileName;
    const profile = getActiveProfile();
    this.baseUrl = profile.url;
  }

  /**
   * Make an authenticated API request
   */
  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, headers = {}, authenticated = true } = options;

    const url = `${this.baseUrl}${path}`;

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers
    };

    // Add authorization header if authenticated
    if (authenticated) {
      const token = await getValidToken(this.profileName || '', this.baseUrl);
      if (token) {
        requestHeaders['Authorization'] = `Bearer ${token}`;
      }
    }

    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined
    });

    // Handle non-JSON responses
    const contentType = response.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      if (!response.ok) {
        throw {
          status: response.status,
          message: `HTTP ${response.status}: ${response.statusText}`,
          error: await response.text()
        } as ApiError;
      }
      return (await response.text()) as unknown as T;
    }

    const data = await response.json() as Record<string, unknown>;

    if (!response.ok) {
      throw {
        status: response.status,
        message: (data.message as string) || (data.error as string) || `HTTP ${response.status}`,
        error: data.error as string,
        details: data.details as Record<string, unknown>
      } as ApiError;
    }

    return data as T;
  }

  /**
   * GET request
   */
  async get<T>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  /**
   * POST request
   */
  async post<T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method'> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'POST', body });
  }

  /**
   * PUT request
   */
  async put<T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method'> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PUT', body });
  }

  /**
   * PATCH request
   */
  async patch<T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method'> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PATCH', body });
  }

  /**
   * DELETE request
   */
  async delete<T>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }

  /**
   * Build query string from object
   */
  static buildQuery(params: Record<string, string | number | boolean | undefined | null>): string {
    const filtered = Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);

    return filtered.length > 0 ? `?${filtered.join('&')}` : '';
  }
}

// Singleton instance for the active profile
let defaultClient: ApiClient | null = null;

/**
 * Get the default API client for the active profile
 */
export function getClient(profileName?: string): ApiClient {
  if (profileName) {
    return new ApiClient(profileName);
  }

  if (!defaultClient) {
    defaultClient = new ApiClient();
  }
  return defaultClient;
}

/**
 * Reset the default client (useful when switching profiles)
 */
export function resetClient(): void {
  defaultClient = null;
}

/**
 * Create an API client with a specific base URL and token
 */
export function createApiClient(baseUrl: string, token: string, insecure?: boolean): ApiClient {
  const fetchOpts = getFetchOptions(insecure);

  return {
    async get<T>(path: string): Promise<T> {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        ...fetchOpts
      });
      const data = await response.json() as Record<string, unknown>;
      if (!response.ok) {
        throw {
          status: response.status,
          message: (data.message as string) || (data.error as string) || `HTTP ${response.status}`,
          error: data.error as string,
          details: data.details as Record<string, unknown>
        } as ApiError;
      }
      return data as T;
    },
    async post<T>(path: string, body?: unknown): Promise<T> {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: body ? JSON.stringify(body) : undefined,
        ...fetchOpts
      });
      const data = await response.json() as Record<string, unknown>;
      if (!response.ok) {
        throw {
          status: response.status,
          message: (data.message as string) || (data.error as string) || `HTTP ${response.status}`,
          error: data.error as string,
          details: data.details as Record<string, unknown>
        } as ApiError;
      }
      return data as T;
    },
    async put<T>(path: string, body?: unknown): Promise<T> {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: body ? JSON.stringify(body) : undefined,
        ...fetchOpts
      });
      const data = await response.json() as Record<string, unknown>;
      if (!response.ok) {
        throw {
          status: response.status,
          message: (data.message as string) || (data.error as string) || `HTTP ${response.status}`,
          error: data.error as string,
          details: data.details as Record<string, unknown>
        } as ApiError;
      }
      return data as T;
    },
    async patch<T>(path: string, body?: unknown): Promise<T> {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: body ? JSON.stringify(body) : undefined,
        ...fetchOpts
      });
      const data = await response.json() as Record<string, unknown>;
      if (!response.ok) {
        throw {
          status: response.status,
          message: (data.message as string) || (data.error as string) || `HTTP ${response.status}`,
          error: data.error as string,
          details: data.details as Record<string, unknown>
        } as ApiError;
      }
      return data as T;
    },
    async delete<T>(path: string): Promise<T> {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        ...fetchOpts
      });
      const data = await response.json() as Record<string, unknown>;
      if (!response.ok) {
        throw {
          status: response.status,
          message: (data.message as string) || (data.error as string) || `HTTP ${response.status}`,
          error: data.error as string,
          details: data.details as Record<string, unknown>
        } as ApiError;
      }
      return data as T;
    }
  } as unknown as ApiClient;
}
