# ASIL Publications & Citation Impact

A static GitHub Pages app that plots a supplied DOI list by publication date and Crossref citation count. Select a point to inspect publication metadata and deposited references.

## Files

- `index.html` — page structure
- `style.css` — responsive styles
- `app.js` — API requests, plot, selection, and details panel
- `dois.txt` — one DOI per line

## Publish on GitHub Pages

1. Create a repository for the app.
2. Upload all four files to the repository root.
3. In repository **Settings → Pages**, configure deployment from the `main` branch and `/ (root)`.
4. Open the published Pages URL.

For local testing, serve the folder with a local HTTP server rather than opening `index.html` directly. For example, if Python is installed, run `python -m http.server 8000` in this folder and open `http://localhost:8000`.

## Data sources

- DOI Citation Formatter metadata endpoint: `https://citation.doi.org/metadata?doi=...`
- Crossref work endpoint: `https://api.crossref.org/works/{doi}`

The DOI Citation Formatter provides CSL-style bibliographic metadata. Crossref provides deposited citation counts (`is-referenced-by-count`) and references (`reference`) when available. These are not universal citation metrics: records can be missing, incomplete, or registered with other DOI agencies. Reference lists only include items deposited in Crossref metadata, and many reference entries do not have DOIs.

The app makes two requests per DOI, using a concurrency limit of six. With 178 unique DOIs, that is up to 356 requests per full load. The browser cache may reduce repeat requests, but this starter version does not persist a full metadata cache across visits.

## Important limitations

- DOI metadata and Crossref records can differ in fields and publication dates. The app prefers Crossref's online publication date, then the DOI formatter's issued date, then Crossref's other publication dates.
- Crossref citation counts count citations indexed by Crossref, not all citations across every database.
- GitHub Pages is static hosting. The browser must be able to reach both API services (including their CORS policies) for live requests to work.
- The first version does not include a server-side cache or scheduled metadata refresh.
