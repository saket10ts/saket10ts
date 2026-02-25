const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

const SCREENER_API_BASE = process.env.SCREENER_API_BASE || '';
const SCREENER_API_TOKEN = process.env.SCREENER_API_TOKEN || '';
const SCREENER_HTML_BASE = process.env.SCREENER_HTML_BASE || 'https://www.screener.in';
const SCREENER_DIRECT_ENABLED = (process.env.SCREENER_DIRECT_ENABLED || 'true').toLowerCase() === 'true';

const SCREENER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,text/plain,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5'
};

const fallbackCompanies = [
  { id: 'TCS', name: 'Tata Consultancy Services', sector: 'IT Services' },
  { id: 'RELIANCE', name: 'Reliance Industries', sector: 'Conglomerate' },
  { id: 'HDFCBANK', name: 'HDFC Bank', sector: 'Banking' }
];

const fallbackDocuments = {
  TCS: [
    {
      id: 'tcs-q3fy25-concall',
      type: 'concall',
      title: 'Q3 FY25 Earnings Call Transcript',
      date: 'Jan 2025',
      sourceUrl: 'https://example.com/tcs-q3fy25-concall.txt'
    },
    {
      id: 'tcs-q3fy25-ppt',
      type: 'ppt',
      title: 'Q3 FY25 Investor Presentation',
      date: 'Jan 2025',
      sourceUrl: 'https://example.com/tcs-q3fy25-ppt.txt'
    }
  ]
};

const fallbackDocumentContent = {
  'tcs-q3fy25-concall':
    'TCS Q3 FY25 concall highlights: revenue growth remained healthy, deal wins remained strong, and margin improved.',
  'tcs-q3fy25-ppt':
    'TCS Q3 FY25 investor presentation notes: healthy BFSI pipeline and cost optimization benefits in delivery.'
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

function notFound(res) {
  sendJson(res, 404, { error: 'Not found' });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function stripHtml(value) {
  return (value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseResponseBody(contentType, text) {
  if (!text) {
    return {};
  }

  const looksLikeJson =
    contentType.includes('application/json') || text.trim().startsWith('{') || text.trim().startsWith('[');

  if (!looksLikeJson) {
    return { raw: text };
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function tryExtractSymbolFromUrl(urlValue) {
  const match = (urlValue || '').match(/\/company\/([^/]+)\//i);
  return match ? match[1].toUpperCase() : '';
}

async function fetchTextFromUrl(urlString, headers = {}) {
  if (!urlString) {
    return '';
  }

  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return '';
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return '';
  }

  try {
    const response = await fetch(parsed, { headers });
    if (!response.ok) {
      return '';
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/pdf')) {
      return '';
    }

    return response.text();
  } catch {
    return '';
  }
}

function buildApiUrl(pathname, query = {}) {
  const url = new URL(pathname, SCREENER_API_BASE);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

async function callScreenerApi(pathname, query = {}) {
  if (!SCREENER_API_BASE) {
    return null;
  }

  const url = buildApiUrl(pathname, query);
  const headers = { Accept: 'application/json, text/plain;q=0.9, */*;q=0.8' };
  if (SCREENER_API_TOKEN) {
    headers.Authorization = `Bearer ${SCREENER_API_TOKEN}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Screener API error: ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  return parseResponseBody(contentType, text);
}

async function searchCompanies(query) {
  if (!query) {
    return fallbackCompanies;
  }

  if (SCREENER_API_BASE) {
    const apiData = await callScreenerApi('/api/screener/company/search', { q: query, v: '3' });
    const list = Array.isArray(apiData) ? apiData : Array.isArray(apiData?.companies) ? apiData.companies : [];

    if (list.length) {
      return list.map((item) => {
        const symbol = tryExtractSymbolFromUrl(item.url) || String(item.symbol || '').toUpperCase() || String(item.id);
        return {
          id: symbol,
          name: item.name || symbol,
          sector: item.id ? `Company ID: ${item.id}` : 'Screener Search',
          companyId: item.id || ''
        };
      });
    }
  }

  if (SCREENER_DIRECT_ENABLED) {
    const symbol = query.toUpperCase();
    const html = await fetchTextFromUrl(`${SCREENER_HTML_BASE}/company/${encodeURIComponent(symbol)}/`, SCREENER_HEADERS);
    if (html) {
      const nameMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      const idMatch = html.match(/data-company-id="(\d+)"/i);
      return [
        {
          id: symbol,
          name: nameMatch ? stripHtml(nameMatch[1]) : symbol,
          sector: idMatch ? `Company ID: ${idMatch[1]}` : 'Screener HTML',
          companyId: idMatch ? idMatch[1] : ''
        }
      ];
    }
  }

  return fallbackCompanies.filter(
    (c) => c.id.toLowerCase().includes(query.toLowerCase()) || c.name.toLowerCase().includes(query.toLowerCase())
  );
}

function parseDocumentsFromScreenerHtml(symbol, html) {
  const docs = [];
  const sectionMatch = html.match(/<section[^>]*id="documents"[^>]*>([\s\S]*?)<\/section>/i);
  const source = sectionMatch ? sectionMatch[1] : html;
  const dateRegex = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}/i;

  const liMatches = [...source.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
  for (const [, block] of liMatches) {
    const date = (block.match(dateRegex) || [])[0] || '';
    const linkMatches = [...block.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];

    for (const [, href, rawText] of linkMatches) {
      const text = stripHtml(rawText).toLowerCase();
      let type = '';
      if (text.includes('ppt')) type = 'ppt';
      else if (text.includes('transcript') || text.includes('concall') || text.includes('notes')) type = 'concall';
      if (!type) continue;

      const sourceUrl = href.startsWith('/') ? `${SCREENER_HTML_BASE}${href}` : href;
      const title = `${type.toUpperCase()}${date ? ` - ${date}` : ''}`;
      const id = `${symbol.toLowerCase()}-${type}-${Buffer.from(sourceUrl).toString('base64url').slice(0, 14)}`;
      docs.push({ id, type, title, date, sourceUrl });
    }
  }

  return docs;
}

async function listDocumentsForCompany(symbol, type) {
  if (SCREENER_API_BASE) {
    const data = await callScreenerApi('/api/screener/company/documents', { symbol });
    const apiDocs = Array.isArray(data?.documents) ? data.documents : Array.isArray(data) ? data : [];
    if (apiDocs.length) {
      let normalized = apiDocs.map((doc) => ({
        id: doc.id || `${symbol.toLowerCase()}-${Buffer.from(String(doc.url || doc.sourceUrl || doc.title || 'doc')).toString('base64url').slice(0, 14)}`,
        type: doc.type || (String(doc.title || '').toLowerCase().includes('ppt') ? 'ppt' : 'concall'),
        title: doc.title || doc.name || 'Document',
        date: doc.date || '',
        sourceUrl: doc.sourceUrl || doc.url || ''
      }));
      if (type) normalized = normalized.filter((d) => d.type === type);
      return normalized;
    }
  }

  if (SCREENER_DIRECT_ENABLED) {
    const html = await fetchTextFromUrl(`${SCREENER_HTML_BASE}/company/${encodeURIComponent(symbol)}/`, SCREENER_HEADERS);
    if (html) {
      let parsed = parseDocumentsFromScreenerHtml(symbol, html);
      if (type) parsed = parsed.filter((d) => d.type === type);
      if (parsed.length) return parsed;
    }
  }

  let docs = fallbackDocuments[symbol] || [];
  if (type) docs = docs.filter((d) => d.type === type);
  return docs;
}

function pickDocumentContent(data) {
  if (!data) return '';
  if (typeof data.content === 'string') return data.content;
  if (typeof data.text === 'string') return data.text;
  if (typeof data.raw === 'string') return data.raw;
  return '';
}

async function loadDocumentContent({ symbol, documentId, sourceUrl }) {
  if (SCREENER_API_BASE) {
    const apiData = await callScreenerApi(`/api/screener/company/${encodeURIComponent(symbol)}/documents/${encodeURIComponent(documentId)}/content`);
    const content = pickDocumentContent(apiData);
    if (content) return content;
  }

  if (sourceUrl) {
    const txt = await fetchTextFromUrl(sourceUrl, SCREENER_HEADERS);
    if (txt) return txt;
  }

  return fallbackDocumentContent[documentId] || '';
}

async function analyzeWithOpenAI({ companyName, documentTitle, content, focusAreas }) {
  if (!OPENAI_API_KEY) {
    return {
      provider: 'fallback-local',
      summary: 'OPENAI_API_KEY missing; returning local heuristic summary for testing.',
      insights: [
        `Document analyzed for: ${companyName} / ${documentTitle}`,
        `Focus areas requested: ${focusAreas.join(', ') || 'General'}`,
        `Detected content length: ${content.length} characters`
      ],
      risks: ['Potential margin pressure if input costs rise.', 'Watch management commentary for demand softness.']
    };
  }

  const prompt = [
    'You are a financial analyst.',
    `Company: ${companyName}`,
    `Document: ${documentTitle}`,
    `Focus areas: ${focusAreas.join(', ') || 'General outlook'}`,
    'Return strict JSON with keys: summary (string), insights (array of strings), risks (array of strings).',
    `Document content:\n${content.slice(0, 15000)}`
  ].join('\n');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.2
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${response.status}`);
  }

  const data = await response.json();
  const contentText = data?.choices?.[0]?.message?.content;
  const parsed = JSON.parse(contentText || '{}');
  return {
    provider: 'openai',
    summary: parsed.summary || 'No summary returned.',
    insights: Array.isArray(parsed.insights) ? parsed.insights : [],
    risks: Array.isArray(parsed.risks) ? parsed.risks : []
  };
}

function serveStaticFile(res, pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(__dirname, 'public', safePath);
  if (!filePath.startsWith(path.join(__dirname, 'public'))) {
    notFound(res);
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      notFound(res);
      return;
    }

    const ext = path.extname(filePath);
    const contentType =
      ext === '.html'
        ? 'text/html; charset=utf-8'
        : ext === '.css'
          ? 'text/css; charset=utf-8'
          : ext === '.js'
            ? 'application/javascript; charset=utf-8'
            : 'text/plain; charset=utf-8';

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  if (!req.url || !req.method) {
    return notFound(res);
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = requestUrl.pathname;

  try {
    if (req.method === 'GET' && pathname === '/api/companies') {
      const q = (requestUrl.searchParams.get('q') || '').trim();
      const companies = await searchCompanies(q);
      return sendJson(res, 200, { companies });
    }

    if (req.method === 'GET' && pathname.startsWith('/api/company/')) {
      const [, , , companyId, resource, documentId, action] = pathname.split('/');
      if (!companyId || resource !== 'documents') {
        return notFound(res);
      }

      if (documentId && action === 'content') {
        const sourceUrl = requestUrl.searchParams.get('sourceUrl') || '';
        const content = await loadDocumentContent({ symbol: companyId, documentId, sourceUrl });

        if (!content) {
          return sendJson(res, 404, {
            error: 'Document content not found. Ensure sourceUrl points to text content or expose a content endpoint.'
          });
        }

        return sendJson(res, 200, { content });
      }

      if (documentId || action) {
        return notFound(res);
      }

      const type = requestUrl.searchParams.get('type') || '';
      const documents = await listDocumentsForCompany(companyId, type);
      return sendJson(res, 200, { documents });
    }

    if (req.method === 'POST' && pathname === '/api/analyze') {
      const body = await readBody(req);
      const { companyName, documentTitle, content, focusAreas } = body;

      if (!companyName || !documentTitle || !content) {
        return sendJson(res, 400, {
          error: 'companyName, documentTitle and content are required'
        });
      }

      const result = await analyzeWithOpenAI({
        companyName,
        documentTitle,
        content,
        focusAreas: Array.isArray(focusAreas) ? focusAreas : []
      });

      return sendJson(res, 200, { result });
    }

    if (pathname.startsWith('/api/')) {
      return notFound(res);
    }

    serveStaticFile(res, pathname);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
