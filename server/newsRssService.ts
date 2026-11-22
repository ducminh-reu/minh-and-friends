import type { NewsArticle } from '../src/types/domain.ts';
import {
  deduplicateNewsArticles,
  parseRssOrAtomItems,
  type RssFeedSource,
} from '../src/utils/newsFeedUtils.ts';

export const NEWS_RSS_SOURCES: RssFeedSource[] = [
  {
    id: 'bbc-russian',
    sourceName: 'BBC Russian',
    url: 'https://feeds.bbci.co.uk/russian/rss.xml',
    sourceLanguage: 'ru',
    defaultTopic: 'international_politics',
  },
  {
    id: 'dw-russian',
    sourceName: 'Deutsche Welle (RU)',
    url: 'https://rss.dw.com/xml/rss-ru-all',
    sourceLanguage: 'ru',
    defaultTopic: 'european_economy_politics',
  },
  {
    id: 'bbc-business',
    sourceName: 'BBC Business',
    url: 'https://feeds.bbci.co.uk/news/business/rss.xml',
    sourceLanguage: 'en',
    defaultTopic: 'business_finance',
  },
  {
    id: 'bbc-tech',
    sourceName: 'BBC Technology',
    url: 'https://feeds.bbci.co.uk/news/technology/rss.xml',
    sourceLanguage: 'en',
    defaultTopic: 'technology',
  },
  {
    id: 'bbc-europe',
    sourceName: 'BBC Europe',
    url: 'https://feeds.bbci.co.uk/news/world/europe/rss.xml',
    sourceLanguage: 'en',
    defaultTopic: 'european_economy_politics',
  },
  {
    id: 'bbc-env',
    sourceName: 'BBC Science & Environment',
    url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
    sourceLanguage: 'en',
    defaultTopic: 'energy_environment',
  },
  {
    id: 'dw-business-en',
    sourceName: 'Deutsche Welle Business',
    url: 'https://rss.dw.com/xml/rss-en-bus',
    sourceLanguage: 'en',
    defaultTopic: 'world_economy',
  },
  {
    id: 'dw-europe-en',
    sourceName: 'Deutsche Welle Europe',
    url: 'https://rss.dw.com/xml/rss-en-eu',
    sourceLanguage: 'en',
    defaultTopic: 'european_economy_politics',
  },
  {
    id: 'guardian-econ',
    sourceName: 'The Guardian Economics',
    url: 'https://www.theguardian.com/business/economics/rss',
    sourceLanguage: 'en',
    defaultTopic: 'world_economy',
  },
  {
    id: 'bbc-world',
    sourceName: 'BBC World',
    url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
    sourceLanguage: 'en',
    defaultTopic: 'geopolitics',
  },
];

export interface NewsFeedFetchResult {
  articles: NewsArticle[];
  fetchedAt: string;
  sourcesUsed: string[];
  failedSources: string[];
  failedDetails: { sourceName: string; error: string }[];
  duplicatesRemoved: number;
  fromCache: boolean;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cachedResult: Omit<NewsFeedFetchResult, 'fromCache'> | null = null;
let cachedAtMs = 0;

async function fetchSingleFeedWithRetry(
  source: RssFeedSource,
  maxAttempts = 2,
): Promise<{
  sourceName: string;
  articles: NewsArticle[];
  ok: boolean;
  error?: string;
}> {
  let lastError = 'Unknown error';
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const resp = await fetch(source.url, {
        headers: {
          'User-Agent': 'RussianDictationApp/1.0 (+RSS Reader)',
          Accept: 'application/rss+xml, application/xml, text/xml, application/atom+xml',
        },
        signal: AbortSignal.timeout(7000),
      });
      if (!resp.ok) {
        lastError = `HTTP ${resp.status}`;
        if (resp.status >= 500 && attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 400 * attempt));
          continue;
        }
        return { sourceName: source.sourceName, articles: [], ok: false, error: lastError };
      }
      const xml = await resp.text();
      const parsed = parseRssOrAtomItems(xml, source).slice(0, 12);
      return { sourceName: source.sourceName, articles: parsed, ok: true };
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Network error';
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
  }
  return { sourceName: source.sourceName, articles: [], ok: false, error: lastError };
}

export async function fetchDailyNewsArticles(
  forceRefresh = false,
): Promise<NewsFeedFetchResult> {
  const nowMs = Date.now();
  if (!forceRefresh && cachedResult && nowMs - cachedAtMs < CACHE_TTL_MS) {
    return { ...cachedResult, fromCache: true };
  }

  const results = await Promise.all(
    NEWS_RSS_SOURCES.map((src) => fetchSingleFeedWithRetry(src, 2)),
  );
  const sourcesUsed: string[] = [];
  const failedSources: string[] = [];
  const failedDetails: { sourceName: string; error: string }[] = [];
  const rawArticles: NewsArticle[] = [];

  for (const res of results) {
    if (res.ok) {
      sourcesUsed.push(res.sourceName);
    } else {
      failedSources.push(res.sourceName);
      failedDetails.push({
        sourceName: res.sourceName,
        error: res.error ?? 'Failed to fetch RSS feed',
      });
    }
    rawArticles.push(...res.articles);
  }

  // Sort newest first before deduplication so fresher canonical stories survive
  rawArticles.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const { unique: articles, duplicatesRemoved } = deduplicateNewsArticles(rawArticles);

  // Never invent news if all feeds failed
  if (articles.length === 0 && cachedResult && cachedResult.articles.length > 0) {
    return { ...cachedResult, fromCache: true, failedSources, failedDetails };
  }

  const freshResult: Omit<NewsFeedFetchResult, 'fromCache'> = {
    articles,
    fetchedAt: new Date(nowMs).toISOString(),
    sourcesUsed,
    failedSources,
    failedDetails,
    duplicatesRemoved,
  };

  if (articles.length > 0) {
    cachedResult = freshResult;
    cachedAtMs = nowMs;
  }

  return { ...freshResult, fromCache: false };
}
