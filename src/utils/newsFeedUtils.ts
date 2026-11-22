import type { NewsArticle, NewsTopicCategory } from '../types/domain';

export interface RssFeedSource {
  id: string;
  sourceName: string;
  url: string;
  sourceLanguage: 'ru' | 'en';
  defaultTopic: NewsTopicCategory;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  laquo: '«',
  raquo: '»',
  hellip: '…',
};

export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const cp = parseInt(hex, 16);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : _;
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const cp = parseInt(dec, 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : _;
    })
    .replace(/&([a-z]+);/gi, (full, name) => NAMED_ENTITIES[name.toLowerCase()] ?? full);
}

export function stripHtmlAndDecodeEntities(raw: string): string {
  const withoutCdata = raw.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, '$1');
  const decoded = decodeHtmlEntities(withoutCdata);
  return decoded
    .replace(/<[^>]+>/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeExternalUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const cleaned = stripHtmlAndDecodeEntities(raw);
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function parseVerifiedRssDate(
  rawDate: string | undefined | null,
): { iso: string; dateKey: string } | null {
  if (!rawDate) return null;
  const cleaned = stripHtmlAndDecodeEntities(rawDate);
  if (!cleaned) return null;
  const ms = Date.parse(cleaned);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const iso = d.toISOString();
  return { iso, dateKey: iso.slice(0, 10) };
}

export function truncateCopyrightSafeSnippet(text: string, maxChars = 340): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

const TOPIC_KEYWORDS: { topic: NewsTopicCategory; patterns: RegExp[] }[] = [
  {
    topic: 'energy_environment',
    patterns: [
      /\b(oil|gas|opec|energy|solar|wind|nuclear|carbon|climate|emission|emissions|renewable|fossil|pipeline|lng|power grid|environment|greenhouse|cop\d+)\b/i,
      /(нефт|газ|энергет|климат|эколог|углерод|выброс|ископаем|возобновляем|аэс|гэс|саммит.*климат|парников)/i,
    ],
  },
  {
    topic: 'technology',
    patterns: [
      /\b(ai|artificial intelligence|tech|technology|chip|semiconductor|nvidia|apple|microsoft|google|meta|cyber|hacker|software|quantum|robot|startup|space|satellite)\b/i,
      /(технолог|искусственн\w* интеллект|нейросет|чип|полупроводник|кибератак|хакер|софт|квантов|робот|космос|спутник|цифров)/i,
    ],
  },
  {
    topic: 'european_economy_politics',
    patterns: [
      /\b(eu|europe|european|brussels|eurozone|ecb|germany|france|poland|uk|britain|schengen|berlin|paris|warsaw|italy|spain)\b/i,
      /(евросоюз|европ|ес|ецб|брюссел|герман|франц|польш|великобритан|берлин|париж|варшав|еврозон)/i,
    ],
  },
  {
    topic: 'geopolitics',
    patterns: [
      /\b(nato|sanction|sanctions|missile|drone|border|arctic|defense|defence|military|geopolitic|security|kaliningrad|baltic|strait|taiwan|ukraine|russia)\b/i,
      /(нато|санкци|геополитик|оборон|безопасност|беспилотник|ракет|калининград|балтик|границ|военн|арктик|тайван|судно|вмс)/i,
    ],
  },
  {
    topic: 'business_finance',
    patterns: [
      /\b(bank|banking|stock|stocks|shares|market|markets|investor|ipo|earnings|profit|revenue|merger|acquisition|startup|crypto|bitcoin|credit|bond|bondholders|fintech|retail)\b/i,
      /(банк|акци|бирж|рынок|рынках|инвестор|прибыл|выручк|сделк|слияни|криптовалют|биткоин|облигац|кредит|компани|бизнес|финанс)/i,
    ],
  },
  {
    topic: 'world_economy',
    patterns: [
      /\b(gdp|inflation|imf|world bank|wto|trade|tariff|tariffs|recession|central bank|fed|federal reserve|interest rate|economic|economy|global growth|currency|dollar|euro)\b/i,
      /(ввп|инфляц|мвф|всемирный банк|вто|торгов|пошлин|тариф|рецесс|центробанк|ключев\w* ставк|экономик|мировой рост|валют|доллар|евро|рубл)/i,
    ],
  },
  {
    topic: 'international_politics',
    patterns: [
      /\b(un|united nations|summit|treaty|diplomat|diplomacy|election|elections|parliament|president|prime minister|minister|embassy|foreign policy)\b/i,
      /(оон|саммит|договор|дипломат|выбор|парламент|президент|премьер|министр|посольств|внешн\w* политик|переговор)/i,
    ],
  },
];

export function classifyNewsTopic(
  title: string,
  snippet: string,
  defaultTopic: NewsTopicCategory,
): NewsTopicCategory {
  const combined = `${title} ${snippet}`;
  for (const rule of TOPIC_KEYWORDS) {
    if (rule.patterns.some((re) => re.test(combined))) {
      return rule.topic;
    }
  }
  return defaultTopic;
}

function extractTagContent(block: string, tagName: string): string | null {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i');
  const match = block.match(re);
  return match ? match[1].trim() : null;
}

function extractAtomLink(block: string): string | null {
  const alternateMatch = block.match(
    /<link[^>]+rel=["']alternate["'][^>]+href=["']([^"']+)["'][^>]*\/?>/i,
  );
  if (alternateMatch?.[1]) return alternateMatch[1];
  const hrefMatch = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*\/?>/i);
  if (hrefMatch?.[1]) return hrefMatch[1];
  return extractTagContent(block, 'link');
}

function stableHash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function parseRssOrAtomItems(
  xml: string,
  feedMeta: Pick<RssFeedSource, 'sourceName' | 'sourceLanguage' | 'defaultTopic'>,
): NewsArticle[] {
  const items: NewsArticle[] = [];
  const itemMatches = xml.match(/<(?:item|entry)(?:\s[^>]*)?>[\s\S]*?<\/(?:item|entry)>/gi) ?? [];

  for (const block of itemMatches) {
    const rawTitle = extractTagContent(block, 'title');
    const rawLink = extractAtomLink(block);
    const rawDate =
      extractTagContent(block, 'pubDate') ??
      extractTagContent(block, 'dc:date') ??
      extractTagContent(block, 'published') ??
      extractTagContent(block, 'updated');
    const rawDesc =
      extractTagContent(block, 'description') ??
      extractTagContent(block, 'summary') ??
      extractTagContent(block, 'content:encoded') ??
      '';

    const title = rawTitle ? stripHtmlAndDecodeEntities(rawTitle) : '';
    const articleUrl = sanitizeExternalUrl(rawLink);
    // Strict honesty rule: NEVER invent publication dates when missing/unparseable
    const verifiedDate = parseVerifiedRssDate(rawDate);

    if (!title || !articleUrl || !verifiedDate) {
      continue;
    }

    const cleanSnippet = truncateCopyrightSafeSnippet(stripHtmlAndDecodeEntities(rawDesc));
    const topic = classifyNewsTopic(title, cleanSnippet, feedMeta.defaultTopic);

    items.push({
      id: `news-${stableHash(articleUrl)}`,
      title,
      summarySnippet: cleanSnippet,
      sourceName: feedMeta.sourceName,
      sourceLanguage: feedMeta.sourceLanguage,
      articleUrl,
      publishedAt: verifiedDate.iso,
      publishedDateKey: verifiedDate.dateKey,
      topic,
    });
  }

  return items;
}

export function filterNewsArticles(
  articles: NewsArticle[],
  filters: {
    topic?: 'ALL' | NewsTopicCategory;
    dateFilter?: string; // 'ALL' | 'today' | 'last_3_days' | 'last_7_days' | 'YYYY-MM-DD'
    search?: string;
    now?: Date;
  },
): NewsArticle[] {
  const topic = filters.topic ?? 'ALL';
  const dateFilter = filters.dateFilter ?? 'ALL';
  const q = (filters.search ?? '').trim().toLowerCase();
  const now = filters.now ?? new Date();
  const todayKey = now.toISOString().slice(0, 10);

  return articles.filter((art) => {
    if (topic !== 'ALL' && art.topic !== topic) return false;

    if (dateFilter !== 'ALL') {
      if (dateFilter === 'today') {
        if (art.publishedDateKey !== todayKey) return false;
      } else if (dateFilter === 'last_3_days' || dateFilter === 'last_7_days') {
        const days = dateFilter === 'last_3_days' ? 3 : 7;
        const diffMs = now.getTime() - Date.parse(art.publishedAt);
        if (!Number.isFinite(diffMs) || diffMs > days * 86_400_000 || diffMs < -86_400_000) {
          return false;
        }
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateFilter)) {
        if (art.publishedDateKey !== dateFilter) return false;
      }
    }

    if (q) {
      const hay = `${art.title} ${art.summarySnippet} ${art.sourceName}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }

    return true;
  });
}

export function mapNewsTopicToLessonTopic(
  newsTopic: NewsTopicCategory,
): 'economics' | 'politics' | 'work' | 'science' | 'environment' {
  switch (newsTopic) {
    case 'world_economy':
      return 'economics';
    case 'business_finance':
      return 'work';
    case 'technology':
      return 'science';
    case 'energy_environment':
      return 'environment';
    case 'international_politics':
    case 'european_economy_politics':
    case 'geopolitics':
    default:
      return 'politics';
  }
}

const TRACKING_QUERY_PARAMS = new Set([
  'at_medium',
  'at_campaign',
  'maca',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'ocid',
  'rss',
]);

export function canonicalizeNewsUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl.trim());
    parsed.hash = '';
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (TRACKING_QUERY_PARAMS.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
      }
    }
    const cleanPath = parsed.pathname.replace(/\/+$/, '') || '/';
    parsed.pathname = cleanPath;
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${parsed.pathname}${parsed.search}`;
  } catch {
    return rawUrl.trim().toLowerCase();
  }
}

export function normalizeHeadlineFingerprint(title: string): string {
  return title
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeHeadline(title: string): Set<string> {
  const norm = normalizeHeadlineFingerprint(title);
  const words = norm.split(' ').filter((w) => w.length >= 3);
  return new Set(words);
}

export function areHeadlinesNearDuplicate(titleA: string, titleB: string): boolean {
  const fpA = normalizeHeadlineFingerprint(titleA);
  const fpB = normalizeHeadlineFingerprint(titleB);
  if (!fpA || !fpB) return false;
  if (fpA === fpB) return true;

  const setA = tokenizeHeadline(fpA);
  const setB = tokenizeHeadline(fpB);
  if (setA.size < 3 || setB.size < 3) return false;

  let intersection = 0;
  for (const w of setA) {
    if (setB.has(w)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  const jaccard = union > 0 ? intersection / union : 0;
  return jaccard >= 0.72;
}

export function deduplicateNewsArticles(articles: NewsArticle[]): {
  unique: NewsArticle[];
  duplicatesRemoved: number;
} {
  const seenUrls = new Set<string>();
  const unique: NewsArticle[] = [];
  let duplicatesRemoved = 0;

  for (const article of articles) {
    const canonical = canonicalizeNewsUrl(article.articleUrl);
    if (seenUrls.has(canonical)) {
      duplicatesRemoved += 1;
      continue;
    }

    const isNearDup = unique.some((existing) =>
      areHeadlinesNearDuplicate(existing.title, article.title),
    );
    if (isNearDup) {
      duplicatesRemoved += 1;
      continue;
    }

    seenUrls.add(canonical);
    unique.push(article);
  }

  return { unique, duplicatesRemoved };
}

const ECONOMIC_POLITICAL_TOPICS = new Set<NewsTopicCategory>([
  'world_economy',
  'international_politics',
  'european_economy_politics',
  'business_finance',
  'geopolitics',
  'energy_environment',
]);

export function isEconomicOrPoliticalNews(topic: NewsTopicCategory): boolean {
  return ECONOMIC_POLITICAL_TOPICS.has(topic);
}

export function selectDailyPipelineStories(
  articles: NewsArticle[],
  alreadyProcessedUrlsOrFingerprints: Set<string>,
  limit = 1,
): NewsArticle[] {
  const candidates = articles.filter((a) => {
    if (!isEconomicOrPoliticalNews(a.topic)) return false;
    const canonical = canonicalizeNewsUrl(a.articleUrl);
    const fp = normalizeHeadlineFingerprint(a.title);
    if (
      alreadyProcessedUrlsOrFingerprints.has(a.id) ||
      alreadyProcessedUrlsOrFingerprints.has(canonical) ||
      alreadyProcessedUrlsOrFingerprints.has(fp)
    ) {
      return false;
    }
    return a.title.trim().length >= 16;
  });

  // Score candidate freshness + richness (prefer substantive economic/political summaries & Russian sources)
  const sorted = [...candidates].sort((a, b) => {
    const score = (item: NewsArticle) => {
      let s = Date.parse(item.publishedAt) / 3_600_000;
      if (item.sourceLanguage === 'ru') s += 4;
      if (item.summarySnippet.length >= 60) s += 3;
      if (item.topic === 'world_economy' || item.topic === 'international_politics') s += 2;
      return s;
    };
    return score(b) - score(a);
  });

  return sorted.slice(0, Math.max(0, limit));
}

