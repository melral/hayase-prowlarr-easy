const DEFAULT_OPTIONS = {
  endpoint: '',
  apiKey: '',
  categories: '5070',
  maxResults: 10,
  strictEpisodeMatching: true,
  proxyBaseUrl: '',
};

const REQUEST_TIMEOUT_MS = 5000;
const CONNECTIVITY_TIMEOUT_MS = 4000;
const SEARCH_ENDPOINT_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_TITLE_VARIANTS = 3;
const MAX_SEARCH_PLANS = 8;
const MAX_CONNECTIVITY_PROBES = 3;
const BATCH_MARKERS = [
  'batch',
  'complete',
  'season pack',
  'collection',
  '全集',
  'complete series',
];
const BAD_MARKERS = ['soundtrack', ' ost ', ' trailer ', ' preview ', ' sample '];
const DUB_PATTERNS = [
  /\b(?:dub|dubbed|dual audio|english dub)\b/i,
  /\b(?:eng(?:lish)?(?:\s+audio|\s+dub)?)\b/i,
];
const SUB_PATTERNS = [/\b(?:sub|subbed|multi-sub|english sub)\b/i];
const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'and', 'season', 'part', 'movie']);
const searchEndpointCache = new Map();

function normalizeOptions(rawOptions = {}) {
  return {
    endpoint: String(rawOptions.endpoint ?? DEFAULT_OPTIONS.endpoint).trim(),
    apiKey: String(rawOptions.apiKey ?? DEFAULT_OPTIONS.apiKey).trim(),
    categories: normalizeCategories(rawOptions.categories ?? DEFAULT_OPTIONS.categories),
    maxResults: clampNumber(rawOptions.maxResults, 1, 100, DEFAULT_OPTIONS.maxResults),
    strictEpisodeMatching: normalizeBoolean(
      rawOptions.strictEpisodeMatching,
      DEFAULT_OPTIONS.strictEpisodeMatching,
    ),
    proxyBaseUrl: normalizeProxyBaseUrl(rawOptions.proxyBaseUrl ?? DEFAULT_OPTIONS.proxyBaseUrl),
  };
}

function normalizeCategories(rawValue) {
  const value = String(rawValue ?? '').trim();
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeProxyBaseUrl(rawValue) {
  const value = String(rawValue ?? '').trim();
  if (!value) {
    return '';
  }

  try {
    return new URL(value).toString().replace(/\/+$/, '');
  } catch {
    return value.replace(/\/+$/, '');
  }
}

function trimTrailingSlashes(value) {
  return String(value ?? '').replace(/\/+$/, '');
}

function getSearchEndpointCacheKey(options) {
  return JSON.stringify({
    endpoint: trimTrailingSlashes(options.endpoint),
    apiKey: options.apiKey,
    proxyBaseUrl: trimTrailingSlashes(options.proxyBaseUrl),
  });
}

function getCachedSearchEndpoints(options) {
  const key = getSearchEndpointCacheKey(options);
  const cached = searchEndpointCache.get(key);

  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    searchEndpointCache.delete(key);
    return null;
  }

  return [...cached.endpoints];
}

function setCachedSearchEndpoints(options, endpoints) {
  const key = getSearchEndpointCacheKey(options);
  searchEndpointCache.set(key, {
    endpoints: [...endpoints],
    expiresAt: Date.now() + SEARCH_ENDPOINT_CACHE_TTL_MS,
  });
}

function clearCachedSearchEndpoints(options) {
  searchEndpointCache.delete(getSearchEndpointCacheKey(options));
}

function normalizeBoolean(value, fallback) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }

    if (normalized === 'false') {
      return false;
    }
  }

  return value == null ? fallback : Boolean(value);
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function ensureConfigured(options) {
  if (!options.endpoint) {
    throw new Error('Configure your Prowlarr Torznab endpoint before using this extension.');
  }

  if (!options.apiKey) {
    throw new Error('Configure your Prowlarr API key before using this extension.');
  }

  try {
    new URL(options.endpoint);
  } catch {
    throw new Error('The configured endpoint is not a valid URL.');
  }

  if (options.proxyBaseUrl) {
    try {
      new URL(options.proxyBaseUrl);
    } catch {
      throw new Error('The configured proxy helper URL is not a valid URL.');
    }
  }
}

function buildSearchUrl(options, searchType, params = {}) {
  const url = new URL(options.endpoint);

  url.searchParams.set('t', searchType);
  url.searchParams.set('limit', String(options.maxResults));
  url.searchParams.set('apikey', options.apiKey);

  if (options.categories.length > 0) {
    url.searchParams.set('cat', options.categories.join(','));
  }

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') {
      continue;
    }

    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

function normalizePathname(pathname) {
  return pathname.replace(/\/+$/, '') || '/';
}

function joinBaseUrl(baseUrl, path) {
  return `${trimTrailingSlashes(baseUrl)}${path}`;
}

function parseProwlarrEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    const pathname = normalizePathname(url.pathname);

    const directMatch = pathname.match(/^(.*)\/(\d+)\/api$/);
    if (directMatch) {
      return {
        mode: 'direct',
        baseUrl: `${url.origin}${trimTrailingSlashes(directMatch[1])}`,
        indexerId: directMatch[2],
      };
    }

    const legacyMatch = pathname.match(
      /^(.*)\/api\/v1\/indexer\/(?:(all)|(\d+))\/results\/torznab(?:\/api)?$/,
    );
    if (legacyMatch) {
      return {
        mode: legacyMatch[2] ? 'all' : 'single',
        baseUrl: `${url.origin}${trimTrailingSlashes(legacyMatch[1])}`,
        indexerId: legacyMatch[3] ?? null,
      };
    }

    if (pathname === '/') {
      return { mode: 'all', baseUrl: url.origin, indexerId: null };
    }

    if (/\/api$/.test(pathname) && !/\/api\/v1\//.test(pathname)) {
      return {
        mode: 'all',
        baseUrl: `${url.origin}${trimTrailingSlashes(pathname.replace(/\/api$/, ''))}`,
        indexerId: null,
      };
    }

    if (!/\/api\b/.test(pathname)) {
      return {
        mode: 'all',
        baseUrl: `${url.origin}${trimTrailingSlashes(pathname)}`,
        indexerId: null,
      };
    }

    return { mode: 'custom', baseUrl: url.origin, indexerId: null };
  } catch {
    return { mode: 'custom', baseUrl: '', indexerId: null };
  }
}

function buildRequestUrl(url, proxyBaseUrl) {
  if (!proxyBaseUrl) {
    return url;
  }

  try {
    const parsed = new URL(url);
    const proxy = new URL(proxyBaseUrl);

    if (
      parsed.origin === proxy.origin ||
      parsed.protocol === 'https:' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === 'localhost'
    ) {
      return url;
    }

    return `${trimTrailingSlashes(proxyBaseUrl)}/proxy?url=${encodeURIComponent(url)}`;
  } catch {
    return url;
  }
}

async function requestText(url, fetchImpl, timeoutMs = REQUEST_TIMEOUT_MS, proxyBaseUrl = '') {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch is not available in this Hayase extension environment.');
  }

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer =
    controller !== null
      ? setTimeout(() => {
          controller.abort();
        }, timeoutMs)
      : null;

  let response;
  const requestUrl = buildRequestUrl(url, proxyBaseUrl);

  try {
    response = await fetchImpl(requestUrl, {
      headers: {
        Accept: 'application/xml,text/xml,application/rss+xml,text/plain;q=0.9,*/*;q=0.8',
      },
      signal: controller?.signal,
    });
  } catch (error) {
    if (timer) {
      clearTimeout(timer);
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(
        `The Prowlarr endpoint did not respond within ${timeoutMs / 1000} seconds.`,
      );
    }

    throw new Error(
      `Could not reach the Prowlarr endpoint: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (timer) {
    clearTimeout(timer);
  }

  const text = await response.text();
  const apiError = extractApiError(text);

  if (!response.ok) {
    const reason =
      apiError ||
      `${response.status} ${response.statusText}`.trim() ||
      'unexpected HTTP error';
    throw new Error(`The Prowlarr endpoint rejected the request: ${reason}.`);
  }

  if (apiError) {
    throw new Error(apiError);
  }

  return text;
}

async function requestJson(url, fetchImpl, timeoutMs = REQUEST_TIMEOUT_MS, proxyBaseUrl = '') {
  const text = await requestText(url, fetchImpl, timeoutMs, proxyBaseUrl);

  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Prowlarr returned invalid JSON while loading enabled indexers.');
  }
}

async function resolveSearchEndpoints(options, fetchImpl, forceRefresh = false) {
  if (!forceRefresh) {
    const cached = getCachedSearchEndpoints(options);
    if (cached) {
      return cached;
    }
  }

  const parsed = parseProwlarrEndpoint(options.endpoint);

  if (parsed.mode === 'direct' || parsed.mode === 'custom') {
    return [options.endpoint];
  }

  if (parsed.mode === 'single' && parsed.indexerId) {
    return [joinBaseUrl(parsed.baseUrl, `/${parsed.indexerId}/api`)];
  }

  const apiUrl = joinBaseUrl(
    parsed.baseUrl,
    `/api/v1/indexer?apikey=${encodeURIComponent(options.apiKey)}`,
  );
  const indexers = await requestJson(apiUrl, fetchImpl, REQUEST_TIMEOUT_MS, options.proxyBaseUrl);

  const endpoints = (Array.isArray(indexers) ? indexers : [])
    .filter((indexer) => indexer?.enable !== false)
    .filter((indexer) => indexer?.protocol === 'torrent')
    .filter((indexer) => indexer?.supportsSearch !== false)
    .sort((left, right) => (right?.priority ?? 0) - (left?.priority ?? 0))
    .map((indexer) => joinBaseUrl(parsed.baseUrl, `/${indexer.id}/api`));

  if (endpoints.length === 0) {
    throw new Error('No enabled searchable torrent indexers were found in Prowlarr.');
  }

  setCachedSearchEndpoints(options, endpoints);
  return endpoints;
}

function buildSearchPlans(kind, query) {
  const plans = [];
  const seen = new Set();
  const titleVariants = buildTitleVariants(query).slice(0, MAX_TITLE_VARIANTS);

  const pushPlan = (searchType, params, strategy) => {
    const key = `${searchType}|${JSON.stringify(params)}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    plans.push({ searchType, params, strategy });
  };

  if (kind === 'movie') {
    if (query.imdbId) {
      pushPlan('movie', { imdbid: stripImdbPrefix(query.imdbId) }, 'identifier');
    }

    if (query.tmdbId) {
      pushPlan('movie', { tmdbid: query.tmdbId }, 'identifier');
    }
  } else if (query.tvdbId) {
    pushPlan(
      'tvsearch',
      {
        tvdbid: query.tvdbId,
        ep: kind === 'single' && query.episode ? query.episode : undefined,
      },
      'identifier',
    );
  }

  for (const title of titleVariants) {
    if (kind === 'movie') {
      pushPlan('movie', { q: title }, 'title');
      continue;
    }

    if (kind === 'single' && query.episode) {
      pushPlan('search', { q: `${title} ${formatEpisodeToken(query.episode)}` }, 'title-episode');
      pushPlan('search', { q: `${title} episode ${query.episode}` }, 'title-episode');
    }

    if (kind === 'batch') {
      pushPlan('search', { q: `${title} batch` }, 'title-batch');
      pushPlan('search', { q: `${title} complete` }, 'title-batch');
    }

    pushPlan('search', { q: title }, 'title');
  }

  return plans.slice(0, MAX_SEARCH_PLANS);
}

function buildTitleVariants(query) {
  const variants = [];
  const seen = new Set();

  for (const rawTitle of query.titles ?? []) {
    const title = String(rawTitle ?? '').trim();
    if (!title) {
      continue;
    }

    const canonical = normalizeTitleForMatch(title);
    if (!canonical || seen.has(canonical)) {
      continue;
    }

    seen.add(canonical);
    variants.push(title);

    const withoutYear = title.replace(/\((?:19|20)\d{2}\)/g, '').trim();
    const normalizedWithoutYear = normalizeTitleForMatch(withoutYear);
    if (
      withoutYear &&
      normalizedWithoutYear &&
      normalizedWithoutYear !== canonical &&
      !seen.has(normalizedWithoutYear)
    ) {
      seen.add(normalizedWithoutYear);
      variants.push(withoutYear);
    }
  }

  return variants;
}

function stripImdbPrefix(value) {
  return String(value ?? '')
    .trim()
    .replace(/^tt/i, '');
}

function formatEpisodeToken(episode) {
  const number = Number(episode);
  if (!Number.isFinite(number)) {
    return String(episode);
  }

  return String(number).padStart(2, '0');
}

function shouldDisableEndpoint(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /did not respond within|Could not reach the Prowlarr endpoint/i.test(message);
}

function normalizeSearchFailure(error) {
  const message = error instanceof Error ? error.message : String(error);

  if (/401|unauthorized|api key/i.test(message)) {
    return new Error(
      'Prowlarr rejected the API key. Generate a fresh API key in Prowlarr and update the extension settings.',
    );
  }

  if (/404|Not Found/i.test(message)) {
    return new Error(
      'Prowlarr could not find that endpoint. Use your Prowlarr base URL or a direct /<indexer-id>/api endpoint.',
    );
  }

  if (/did not respond within/i.test(message)) {
    return new Error(
      'Prowlarr search timed out. Try a direct /<indexer-id>/api endpoint, keep maxResults low, or configure proxyBaseUrl.',
    );
  }

  return error instanceof Error ? error : new Error(message);
}

async function search(kind, query, rawOptions = {}) {
  const options = normalizeOptions(rawOptions);
  ensureConfigured(options);

  const fetchImpl = query?.fetch ?? globalThis.fetch;
  const searchEndpoints = await resolveSearchEndpoints(options, fetchImpl);
  const plans = buildSearchPlans(kind, query);

  if (plans.length === 0) {
    return [];
  }

  const deduped = new Map();
  const disabledEndpoints = new Set();
  let completedRequests = 0;
  let lastError = null;

  for (const plan of plans) {
    const activeEndpoints = searchEndpoints.filter((endpoint) => !disabledEndpoints.has(endpoint));
    if (activeEndpoints.length === 0) {
      break;
    }

    const responses = await Promise.all(
      activeEndpoints.map(async (endpoint) => {
        const endpointOptions = { ...options, endpoint };

        try {
          const xml = await requestText(
            buildSearchUrl(endpointOptions, plan.searchType, plan.params),
            fetchImpl,
            REQUEST_TIMEOUT_MS,
            options.proxyBaseUrl,
          );

          return { endpoint, xml, error: null };
        } catch (error) {
          return { endpoint, xml: '', error };
        }
      }),
    );

    for (const response of responses) {
      if (response.error) {
        lastError = response.error;
        if (shouldDisableEndpoint(response.error)) {
          disabledEndpoints.add(response.endpoint);
        }

        continue;
      }

      completedRequests += 1;

      for (const itemXml of parseItems(response.xml)) {
        const parsed = parseResultItem(itemXml, kind, plan, query, options);
        if (!parsed) {
          continue;
        }

        const existing = deduped.get(parsed.hash);
        if (!existing || parsed._score > existing._score) {
          deduped.set(parsed.hash, parsed);
        }
      }
    }

    if (deduped.size >= options.maxResults) {
      break;
    }
  }

  const results = [...deduped.values()]
    .sort(compareResults)
    .slice(0, options.maxResults)
    .map(stripInternalFields);

  if (results.length > 0) {
    return results;
  }

  if (completedRequests === 0 && lastError) {
    clearCachedSearchEndpoints(options);
    throw normalizeSearchFailure(lastError);
  }

  return [];
}

function parseItems(xml) {
  const matches = xml.match(/<item\b[\s\S]*?<\/item>/gi);
  return matches ?? [];
}

function parseResultItem(itemXml, kind, plan, query, options) {
  const title = decodeXml(extractTag(itemXml, 'title'));
  if (!title) {
    return null;
  }

  const normalizedTitle = ` ${normalizeTitleForMatch(title)} `;
  if (BAD_MARKERS.some((marker) => normalizedTitle.includes(marker))) {
    return null;
  }

  if (containsExcludedKeyword(normalizedTitle, query.exclusions ?? [])) {
    return null;
  }

  const attrs = extractTorznabAttrs(itemXml);
  const enclosure = extractEnclosure(itemXml);
  const linkCandidate =
    attrs.magneturl ||
    enclosure.url ||
    decodeXml(extractTag(itemXml, 'link')) ||
    decodeXml(extractTag(itemXml, 'guid'));
  const infoHash =
    normalizeInfoHash(attrs.infohash) ||
    normalizeInfoHash(attrs.hash) ||
    normalizeInfoHash(linkCandidate);

  if (!infoHash) {
    return null;
  }

  const scoring = scoreResultTitle(title, normalizedTitle, kind, plan, query, options);
  if (scoring.rejected) {
    return null;
  }

  const size =
    parseInteger(attrs.size) ||
    parseInteger(extractTag(itemXml, 'size')) ||
    parseInteger(enclosure.length) ||
    0;
  const seeders = parseInteger(attrs.seeders) || 0;
  const leechers = parseInteger(attrs.leechers) || estimateLeechers(attrs.peers, seeders);
  const downloads = parseInteger(attrs.grabs) || 0;
  const publishedAt = parseDate(
    extractTag(itemXml, 'pubDate') || attrs.publishdate || attrs.pubdate,
  );
  const link = selectDownloadLink(linkCandidate, infoHash);

  return {
    title,
    link,
    seeders,
    leechers,
    downloads,
    accuracy: scoring.accuracy,
    hash: infoHash,
    size,
    date: publishedAt,
    type: scoring.type,
    _score: scoring.score + seeders * 0.05 + publishedAt.getTime() / 10 ** 14,
  };
}

function compareResults(left, right) {
  return right._score - left._score;
}

function stripInternalFields(result) {
  return {
    title: result.title,
    link: result.link,
    seeders: result.seeders,
    leechers: result.leechers,
    downloads: result.downloads,
    accuracy: result.accuracy,
    hash: result.hash,
    size: result.size,
    date: result.date,
    ...(result.type ? { type: result.type } : {}),
  };
}

function estimateLeechers(rawPeers, seeders) {
  const peers = parseInteger(rawPeers);
  if (!peers) {
    return 0;
  }

  return Math.max(0, peers - seeders);
}

function selectDownloadLink(linkCandidate, infoHash) {
  const link = decodeXml(linkCandidate || '').trim();
  if (/^magnet:\?/i.test(link)) {
    return link;
  }

  if (/\.torrent(?:$|[?#])/i.test(link)) {
    return link;
  }

  return infoHash;
}

function scoreResultTitle(title, normalizedTitle, kind, plan, query, options) {
  const titleSimilarity = computeTitleSimilarity(normalizedTitle, query.titles ?? []);
  const minimumSimilarity = plan.strategy === 'identifier' ? 0.35 : 0.55;

  if (titleSimilarity < minimumSimilarity) {
    return { rejected: true };
  }

  let score = plan.strategy === 'identifier' ? 70 : 40;
  score += Math.round(titleSimilarity * 30);

  let resultType;

  if (kind === 'single' && query.episode) {
    const hasEpisode = matchesEpisodeNumber(normalizedTitle, query.episode);
    const looksBatch = looksLikeBatch(normalizedTitle, query.episodeCount);

    if (hasEpisode) {
      score += 25;
    } else if (looksBatch) {
      score -= 15;
    } else if (options.strictEpisodeMatching) {
      return { rejected: true };
    }
  }

  if (kind === 'batch') {
    if (looksLikeBatch(normalizedTitle, query.episodeCount)) {
      score += 25;
      resultType = 'batch';
    } else {
      score -= 10;
    }
  }

  if (query.resolution && normalizedTitle.includes(String(query.resolution))) {
    score += 8;
  }

  if (query.type === 'dub') {
    if (DUB_PATTERNS.some((pattern) => pattern.test(title))) {
      score += 10;
    } else {
      score -= 5;
    }
  }

  if (query.type === 'sub') {
    if (SUB_PATTERNS.some((pattern) => pattern.test(title))) {
      score += 6;
    }

    if (DUB_PATTERNS.some((pattern) => pattern.test(title))) {
      score -= 3;
    }
  }

  return {
    rejected: false,
    score,
    type: resultType,
    accuracy: score >= 95 ? 'high' : score >= 65 ? 'medium' : 'low',
  };
}

function computeTitleSimilarity(normalizedResultTitle, titles) {
  let best = 0;

  for (const rawTitle of titles) {
    const normalizedTitle = normalizeTitleForMatch(rawTitle);
    if (!normalizedTitle) {
      continue;
    }

    const titleTokens = normalizedTitle
      .split(' ')
      .filter((token) => token && !STOP_WORDS.has(token));

    if (titleTokens.length === 0) {
      continue;
    }

    const matchedTokens = titleTokens.filter((token) => normalizedResultTitle.includes(token)).length;
    let ratio = matchedTokens / titleTokens.length;

    if (normalizedResultTitle.includes(normalizedTitle)) {
      ratio += 0.35;
    }

    best = Math.max(best, ratio);
  }

  return best;
}

function looksLikeBatch(normalizedTitle, episodeCount) {
  if (BATCH_MARKERS.some((marker) => normalizedTitle.includes(marker))) {
    return true;
  }

  if (/\b(?:s\d{1,2}|season\s+\d{1,2})\b/i.test(normalizedTitle)) {
    return true;
  }

  if (/\b\d{1,3}\s*-\s*\d{1,3}\b/.test(normalizedTitle)) {
    return true;
  }

  if (Number.isFinite(Number(episodeCount)) && Number(episodeCount) > 1) {
    const total = String(episodeCount).padStart(2, '0');
    if (new RegExp(`\\b0?1\\s*-\\s*${total}\\b`).test(normalizedTitle)) {
      return true;
    }
  }

  return false;
}

function matchesEpisodeNumber(normalizedTitle, episode) {
  const number = Number(episode);
  if (!Number.isFinite(number)) {
    return false;
  }

  const raw = String(number);
  const padded2 = raw.padStart(2, '0');
  const padded3 = raw.padStart(3, '0');
  const patterns = [
    new RegExp(`\\b(?:e|ep|episode)\\s*0*${raw}(?:v\\d+)?\\b`, 'i'),
    new RegExp(`(?:^|[\\s._\\-\\[])(?:${padded2}|${padded3}|${raw})(?:v\\d+)?(?:$|[\\s._\\-\\]])`, 'i'),
  ];

  return patterns.some((pattern) => pattern.test(normalizedTitle));
}

function containsExcludedKeyword(normalizedTitle, exclusions) {
  for (const exclusion of exclusions) {
    const needle = normalizeTitleForMatch(exclusion);
    if (needle && normalizedTitle.includes(needle)) {
      return true;
    }
  }

  return false;
}

function normalizeTitleForMatch(value) {
  return decodeXml(String(value ?? ''))
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function extractApiError(xml) {
  const match = xml.match(/<error\b[^>]*description=(['"])(.*?)\1/i);
  return match ? decodeXml(match[2]) : '';
}

function extractTag(xml, tagName) {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = xml.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return match ? stripCdata(match[1]).trim() : '';
}

function extractEnclosure(xml) {
  const match = xml.match(/<enclosure\b([^>]*)\/?>/i);
  if (!match) {
    return { url: '', length: '' };
  }

  return {
    url: extractAttribute(match[1], 'url'),
    length: extractAttribute(match[1], 'length'),
  };
}

function extractTorznabAttrs(xml) {
  const attrs = {};
  const pattern = /<(?:\w+:)?attr\b([^>]*)\/?>/gi;
  let match;

  while ((match = pattern.exec(xml)) !== null) {
    const name = extractAttribute(match[1], 'name').toLowerCase();
    const value = decodeXml(extractAttribute(match[1], 'value'));

    if (name) {
      attrs[name] = value;
    }
  }

  return attrs;
}

function extractAttribute(fragment, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = fragment.match(new RegExp(`${escaped}\\s*=\\s*(['"])(.*?)\\1`, 'i'));
  return match ? match[2] : '';
}

function stripCdata(value) {
  return String(value ?? '').replace(/^<!\[CDATA\[|\]\]>$/g, '');
}

function decodeXml(value) {
  return String(value ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, numeric) => String.fromCodePoint(parseInt(numeric, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

function normalizeInfoHash(value) {
  const candidate = decodeXml(value || '');
  const hexMatch = candidate.match(/\b[a-fA-F0-9]{40}\b/);
  if (hexMatch) {
    return hexMatch[0].toUpperCase();
  }

  const magnetMatch = candidate.match(/xt=urn:btih:([A-Za-z0-9]+)/i);
  if (!magnetMatch) {
    return '';
  }

  const btih = magnetMatch[1];
  if (/^[a-fA-F0-9]{40}$/.test(btih)) {
    return btih.toUpperCase();
  }

  if (/^[A-Z2-7]{32}$/i.test(btih)) {
    return base32ToHex(btih);
  }

  return '';
}

function base32ToHex(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';

  for (const character of String(value).toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index === -1) {
      return '';
    }

    bits += index.toString(2).padStart(5, '0');
  }

  let hex = '';
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    hex += Number.parseInt(bits.slice(index, index + 8), 2).toString(16).padStart(2, '0');
  }

  return hex.slice(0, 40).toUpperCase();
}

function parseInteger(value) {
  if (value === undefined || value === null || value === '') {
    return 0;
  }

  const numeric = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseDate(value) {
  const parsed = new Date(value || 0);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

async function test(options = {}) {
  if (!options || Object.keys(options).length === 0) {
    return true;
  }

  const config = normalizeOptions(options);
  ensureConfigured(config);
  const searchEndpoints = await resolveSearchEndpoints(config, globalThis.fetch, true);
  const probeEndpoints = searchEndpoints.slice(0, MAX_CONNECTIVITY_PROBES);

  let lastError = null;

  for (const endpoint of probeEndpoints) {
    try {
      const xml = await requestText(
        buildSearchUrl({ ...config, endpoint }, 'caps'),
        globalThis.fetch,
        CONNECTIVITY_TIMEOUT_MS,
        config.proxyBaseUrl,
      );

      if (!/<(?:caps|rss)\b/i.test(xml)) {
        throw new Error('The endpoint responded, but not with Torznab-compatible XML.');
      }

      return true;
    } catch (error) {
      lastError = error;
    }
  }

  clearCachedSearchEndpoints(config);

  if (lastError) {
    throw normalizeSearchFailure(lastError);
  }

  return true;
}

const extension = {
  test,
  single(query, options) {
    return search('single', query, options);
  },
  batch(query, options) {
    return search('batch', query, options);
  },
  movie(query, options) {
    return search('movie', query, options);
  },
  async query() {
    return undefined;
  },
};

export default extension;
