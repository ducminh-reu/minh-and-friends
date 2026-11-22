import test from 'node:test';
import assert from 'node:assert/strict';
import {
  areHeadlinesNearDuplicate,
  canonicalizeNewsUrl,
  classifyNewsTopic,
  deduplicateNewsArticles,
  filterNewsArticles,
  parseRssOrAtomItems,
  parseVerifiedRssDate,
  sanitizeExternalUrl,
  selectDailyPipelineStories,
  stripHtmlAndDecodeEntities,
} from './newsFeedUtils';

test('parseRssOrAtomItems extracts verified articles and drops items without publication date', () => {
  const xml = `
    <rss version="2.0">
      <channel>
        <item>
          <title><![CDATA[Климатический саммит зашел в тупик]]></title>
          <description><![CDATA[<p>Переговоры по выбросам &amp; энергетике продолжаются.</p>]]></description>
          <link>https://www.bbc.com/russian/articles/test-climate</link>
          <pubDate>Sat, 21 Nov 2026 17:10:17 GMT</pubDate>
        </item>
        <item>
          <title><![CDATA[Live feed without pubDate]]></title>
          <description><![CDATA[No date here]]></description>
          <link>https://www.bbc.com/russian/live/no-date</link>
        </item>
        <item>
          <title>Unsafe link</title>
          <link>javascript:alert(1)</link>
          <pubDate>Sat, 21 Nov 2026 18:00:00 GMT</pubDate>
        </item>
      </channel>
    </rss>
  `;

  const parsed = parseRssOrAtomItems(xml, {
    sourceName: 'BBC Russian',
    sourceLanguage: 'ru',
    defaultTopic: 'international_politics',
  });

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].title, 'Климатический саммит зашел в тупик');
  assert.equal(parsed[0].summarySnippet, 'Переговоры по выбросам & энергетике продолжаются.');
  assert.equal(parsed[0].publishedDateKey, '2026-11-21');
  assert.equal(parsed[0].topic, 'energy_environment');
  assert.equal(parsed[0].articleUrl, 'https://www.bbc.com/russian/articles/test-climate');
});

test('sanitizeExternalUrl allows http/https and rejects javascript/data protocols', () => {
  assert.equal(sanitizeExternalUrl('https://dw.com/ru/news'), 'https://dw.com/ru/news');
  assert.equal(sanitizeExternalUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeExternalUrl('data:text/html,hi'), null);
});

test('parseVerifiedRssDate never invents a fallback date when empty or invalid', () => {
  assert.equal(parseVerifiedRssDate(''), null);
  assert.equal(parseVerifiedRssDate('not-a-date'), null);
  assert.equal(parseVerifiedRssDate('2026-11-21T12:00:00Z')?.dateKey, '2026-11-21');
});

test('stripHtmlAndDecodeEntities removes markup and decodes entities cleanly', () => {
  assert.equal(
    stripHtmlAndDecodeEntities('<p>ECB &quot;rate&quot; &mdash; <b>3.5%</b></p>'),
    'ECB "rate" — 3.5%',
  );
});

test('classifyNewsTopic maps Russian and English headlines across requested domains', () => {
  assert.equal(
    classifyNewsTopic('ЕЦБ оценил инфляцию в еврозоне', '', 'world_economy'),
    'european_economy_politics',
  );
  assert.equal(
    classifyNewsTopic('New AI semiconductor chip unveiled', '', 'business_finance'),
    'technology',
  );
  assert.equal(
    classifyNewsTopic('Global inflation and IMF growth outlook', '', 'international_politics'),
    'world_economy',
  );
});

test('filterNewsArticles filters by topic, exact/range date, and search query', () => {
  const articles = [
    {
      id: '1',
      title: 'Инфляция и курс евро',
      summarySnippet: 'Аналитика ЕЦБ',
      sourceName: 'DW',
      sourceLanguage: 'ru' as const,
      articleUrl: 'https://dw.com/1',
      publishedAt: '2026-11-21T10:00:00.000Z',
      publishedDateKey: '2026-11-21',
      topic: 'european_economy_politics' as const,
    },
    {
      id: '2',
      title: 'AI chips rally',
      summarySnippet: 'Market rally in tech',
      sourceName: 'BBC Business',
      sourceLanguage: 'en' as const,
      articleUrl: 'https://bbc.com/2',
      publishedAt: '2026-11-12T10:00:00.000Z',
      publishedDateKey: '2026-11-12',
      topic: 'technology' as const,
    },
  ];

  const now = new Date('2026-11-21T15:00:00.000Z');
  assert.equal(filterNewsArticles(articles, { dateFilter: 'today', now }).length, 1);
  assert.equal(filterNewsArticles(articles, { dateFilter: '2026-11-12', now }).length, 1);
  assert.equal(filterNewsArticles(articles, { topic: 'technology', now }).length, 1);
  assert.equal(filterNewsArticles(articles, { search: 'ЕЦБ', now }).length, 1);
});

test('canonicalizeNewsUrl strips tracking parameters and trailing slashes', () => {
  assert.equal(
    canonicalizeNewsUrl('https://www.BBC.com/russian/articles/c123/?at_medium=RSS&utm_source=feed#top'),
    'https://www.bbc.com/russian/articles/c123',
  );
});

test('areHeadlinesNearDuplicate and deduplicateNewsArticles remove syndicated and URL duplicates', () => {
  assert.equal(
    areHeadlinesNearDuplicate(
      'Европейский центральный банк сохранил базовую ставку без изменений',
      'Европейский центральный банк сохранил базовую ставку без изменений!',
    ),
    true,
  );
  assert.equal(
    areHeadlinesNearDuplicate(
      'European central bank holds interest rates steady amid inflation concerns',
      'European central bank holds interest rates steady amid inflation fears',
    ),
    true,
  );

  const result = deduplicateNewsArticles([
    {
      id: 'a1',
      title: 'European central bank holds interest rates steady amid inflation concerns',
      summarySnippet: 'Summary 1',
      sourceName: 'DW',
      sourceLanguage: 'en',
      articleUrl: 'https://dw.com/en/ecb-rate?utm_source=rss',
      publishedAt: '2026-11-21T10:00:00.000Z',
      publishedDateKey: '2026-11-21',
      topic: 'european_economy_politics',
    },
    {
      id: 'a2',
      title: 'ECB rate repeat with tracking params',
      summarySnippet: 'Duplicate canonical URL',
      sourceName: 'DW Mirror',
      sourceLanguage: 'en',
      articleUrl: 'https://dw.com/en/ecb-rate/?at_campaign=news',
      publishedAt: '2026-11-21T09:00:00.000Z',
      publishedDateKey: '2026-11-21',
      topic: 'european_economy_politics',
    },
    {
      id: 'a3',
      title: 'European central bank holds interest rates steady amid inflation fears',
      summarySnippet: 'Near duplicate headline',
      sourceName: 'BBC',
      sourceLanguage: 'en',
      articleUrl: 'https://bbc.com/news/ecb-rate',
      publishedAt: '2026-11-21T08:00:00.000Z',
      publishedDateKey: '2026-11-21',
      topic: 'european_economy_politics',
    },
    {
      id: 'a4',
      title: 'Саммит стран ЕС по энергетической безопасности открылся в Брюсселе',
      summarySnippet: 'Энергетика и промышленность Европы.',
      sourceName: 'DW Russian',
      sourceLanguage: 'ru',
      articleUrl: 'https://dw.com/ru/eu-energy-summit',
      publishedAt: '2026-11-21T11:00:00.000Z',
      publishedDateKey: '2026-11-21',
      topic: 'energy_environment',
    },
  ]);

  assert.equal(result.unique.length, 2);
  assert.equal(result.duplicatesRemoved, 2);
});

test('selectDailyPipelineStories filters already processed stories and prioritizes fresh economic/political news', () => {
  const articles = [
    {
      id: 'processed-1',
      title: 'Уже обработанная новость экономики мира за сегодня',
      summarySnippet: 'Достаточно длинное описание экономической новости.',
      sourceName: 'BBC Russian',
      sourceLanguage: 'ru' as const,
      articleUrl: 'https://bbc.com/ru/processed-1?utm_medium=rss',
      publishedAt: '2026-11-21T14:00:00.000Z',
      publishedDateKey: '2026-11-21',
      topic: 'world_economy' as const,
    },
    {
      id: 'fresh-ru',
      title: 'Новые тарифы и прогнозы инфляции обсудили министры финансов',
      summarySnippet: 'Министры финансов обсудили глобальный рост, инфляцию и торговые потоки.',
      sourceName: 'DW Russian',
      sourceLanguage: 'ru' as const,
      articleUrl: 'https://dw.com/ru/finance-ministers',
      publishedAt: '2026-11-21T12:00:00.000Z',
      publishedDateKey: '2026-11-21',
      topic: 'world_economy' as const,
    },
    {
      id: 'fresh-tech',
      title: 'Tech startup announces smartphone case color options',
      summarySnippet: 'Consumer accessory release.',
      sourceName: 'BBC Tech',
      sourceLanguage: 'en' as const,
      articleUrl: 'https://bbc.com/tech/case',
      publishedAt: '2026-11-21T13:00:00.000Z',
      publishedDateKey: '2026-11-21',
      topic: 'technology' as const,
    },
  ];

  const processed = new Set<string>([canonicalizeNewsUrl('https://bbc.com/ru/processed-1')]);
  const selected = selectDailyPipelineStories(articles, processed, 2);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].id, 'fresh-ru');
});

