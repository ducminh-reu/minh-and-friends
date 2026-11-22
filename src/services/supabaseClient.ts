import { createClient, type SupabaseClient } from '@supabase/supabase-js';

interface PublicSupabaseConfig {
  configured: boolean;
  url: string | null;
  anonKey: string | null;
}

let cachedClient: SupabaseClient | null = null;
let cachedConfig: PublicSupabaseConfig | null = null;
let pendingResolution: Promise<SupabaseClient | null> | null = null;

export function normalizeSupabaseUrl(raw: string | undefined | null): string | null {
  const trimmed = raw?.trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z0-9-]+$/i.test(trimmed)) {
    return `https://${trimmed}.supabase.co`;
  }
  return `https://${trimmed}`;
}

function readBuildTimeConfig(): PublicSupabaseConfig {
  const rawUrl =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL
      ? String(import.meta.env.VITE_SUPABASE_URL)
      : '';
  const url = normalizeSupabaseUrl(rawUrl);
  const anonKey =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY
      ? String(import.meta.env.VITE_SUPABASE_ANON_KEY).trim()
      : '';

  if (url && anonKey) {
    return { configured: true, url, anonKey };
  }
  return { configured: false, url: null, anonKey: null };
}

async function fetchPublicRuntimeConfig(): Promise<PublicSupabaseConfig> {
  const buildConfig = readBuildTimeConfig();
  if (buildConfig.configured) {
    return buildConfig;
  }

  try {
    const res = await fetch('/api/supabase/public-config', { cache: 'no-store' });
    if (!res.ok) {
      return { configured: false, url: null, anonKey: null };
    }
    const data = (await res.json()) as Partial<PublicSupabaseConfig>;
    const normalizedUrl = normalizeSupabaseUrl(data.url);
    if (data.configured && normalizedUrl && data.anonKey) {
      return {
        configured: true,
        url: normalizedUrl,
        anonKey: String(data.anonKey).trim(),
      };
    }
    return { configured: false, url: null, anonKey: null };
  } catch {
    return { configured: false, url: null, anonKey: null };
  }
}

export function getCachedSupabaseClient(): SupabaseClient | null {
  return cachedClient;
}

export function isSupabaseRuntimeConfigured(): boolean {
  if (cachedConfig?.configured) return true;
  return readBuildTimeConfig().configured;
}

export async function getSupabaseClient(): Promise<SupabaseClient | null> {
  if (cachedClient) {
    return cachedClient;
  }

  if (pendingResolution) {
    return pendingResolution;
  }

  pendingResolution = (async () => {
    try {
      const cfg = await fetchPublicRuntimeConfig();
      cachedConfig = cfg;
      if (!cfg.configured || !cfg.url || !cfg.anonKey) {
        console.info('[Supabase Client] Supabase is not configured or missing URL/anonKey.');
        return null;
      }

      if (!cachedClient) {
        console.info('[Supabase Client] Initializing Supabase client with URL:', cfg.url);
        cachedClient = createClient(cfg.url, cfg.anonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            storageKey: 'rd_supabase_auth_v1',
          },
        });
      }
      return cachedClient;
    } finally {
      pendingResolution = null;
    }
  })();

  return pendingResolution;
}

export interface SupabaseSchemaStatus {
  configured: boolean;
  reachable: boolean;
  schemaReady: boolean;
  missingTables: string[];
  error?: string | null;
}

export async function checkRemoteSchemaStatus(): Promise<SupabaseSchemaStatus> {
  try {
    const res = await fetch('/api/supabase/schema-status', { cache: 'no-store' });
    if (!res.ok) {
      return {
        configured: isSupabaseRuntimeConfigured(),
        reachable: false,
        schemaReady: false,
        missingTables: [],
        error: `HTTP ${res.status}`,
      };
    }
    return (await res.json()) as SupabaseSchemaStatus;
  } catch (err) {
    return {
      configured: isSupabaseRuntimeConfigured(),
      reachable: false,
      schemaReady: false,
      missingTables: [],
      error: err instanceof Error ? err.message : 'NETWORK_ERROR',
    };
  }
}
