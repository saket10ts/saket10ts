## Screener + AI Analyzer (Local Test Server)

This app gives a local UI + server to:
- search companies,
- load concall/PPT links,
- fetch document content (txt/json),
- run AI analysis.

## Run

```bash
cp .env.example .env
node server.js
```

Open `http://localhost:3000`.

## Config

- `SCREENER_API_BASE`: your API domain (optional).
- `SCREENER_API_TOKEN`: bearer token if required.
- `SCREENER_HTML_BASE`: defaults to `https://www.screener.in`.
- `SCREENER_DIRECT_ENABLED`: `true/false`, use direct Screener HTML scraping fallback.
- `OPENAI_API_KEY`: optional for LLM analysis.
- `PORT`: default `3000`.

## File-2 endpoint mapping implemented

When `SCREENER_API_BASE` is set, this server maps to the documented endpoints:

- Company search:
  - local route: `GET /api/companies?q=RELIANCE`
  - upstream: `GET /api/screener/company/search?q=RELIANCE&v=3`

- Documents list:
  - local route: `GET /api/company/:symbol/documents?type=concall|ppt`
  - upstream preferred: `GET /api/screener/company/documents?symbol=:symbol`
  - fallback: scrape `https://www.screener.in/company/:symbol/` documents section

- Document content:
  - local route: `GET /api/company/:symbol/documents/:documentId/content?sourceUrl=...`
  - upstream preferred: `GET /api/screener/company/:symbol/documents/:documentId/content`
  - fallback: fetch `sourceUrl` directly (supports plain txt bodies)

## Notes

- If your document link is PDF, this server does not parse PDF text yet.
- Plain text (`.txt`) and text-like HTML responses are supported for analysis.
- If OpenAI key is missing, analysis uses local heuristic fallback so full flow still works.
