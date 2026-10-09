/* ASIL Publications & Citation Impact
 * Source list: dois.txt (one DOI per line).
 * Bibliographic metadata: DOI Citation Formatter.
 * Citation counts and deposited references: Crossref REST API.
 */

const DOI_LIST_URL = "dois.txt";
const DOI_METADATA_URL = "https://citation.doi.org/metadata";
const CROSSREF_URL = "https://api.crossref.org/works/";
const CONCURRENCY = 6;

const chartEl = document.getElementById("chart");
const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");
const detailsEl = document.getElementById("details");

let publications = [];
let selectedDoi = null;

function cleanDoi(value) {
  return value.trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim();
}

function dateFromParts(parts) {
  if (!Array.isArray(parts) || !parts.length || !Array.isArray(parts[0])) return null;
  const p = parts[0];
  if (!Number.isFinite(Number(p[0]))) return null;
  const year = Number(p[0]);
  const month = Number(p[1] || 1);
  const day = Number(p[2] || 1);
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

function chooseDate(csl, crossref) {
  // Prefer online date when available; otherwise use the formatter's issued date,
  // then Crossref's best available publication date.
  return dateFromParts(crossref?.["published-online"]?.["date-parts"])
    || dateFromParts(csl?.issued?.["date-parts"])
    || dateFromParts(crossref?.published?.["date-parts"])
    || dateFromParts(crossref?.["published-print"]?.["date-parts"])
    || dateFromParts(crossref?.created?.["date-parts"]);
}

function firstText(value) {
  if (Array.isArray(value)) return value.find(v => typeof v === "string" && v.trim()) || "";
  return typeof value === "string" ? value : "";
}

function authorName(author) {
  if (!author) return "";
  if (author.literal) return author.literal;
  return [author.given, author.family].filter(Boolean).join(" ");
}

function normalizeReference(ref, index) {
  const doi = cleanDoi(ref?.DOI || ref?.doi || "");
  const title = firstText(ref?.["article-title"]) || firstText(ref?.title) ||
    [ref?.author, ref?.year, ref?.["journal-title"]].filter(Boolean).join(" · ") ||
    `Reference ${index + 1}`;
  return {
    doi,
    title,
    year: ref?.year || "",
    journal: ref?.["journal-title"] || "",
    volume: ref?.volume || "",
    issue: ref?.issue || "",
    firstPage: ref?.["first-page"] || "",
    url: doi ? `https://doi.org/${encodeURI(doi)}` : ""
  };
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchOne(doi) {
  const encoded = encodeURIComponent(doi);
  const cslPromise = fetchJson(`${DOI_METADATA_URL}?doi=${encoded}`)
    .catch(error => ({ __error: error.message }));
  const crossrefPromise = fetchJson(`${CROSSREF_URL}${encoded}`)
    .then(data => data.message)
    .catch(error => ({ __error: error.message }));

  const [cslResult, crossrefResult] = await Promise.all([cslPromise, crossrefPromise]);
  const csl = cslResult?.__error ? null : cslResult;
  const crossref = crossrefResult?.__error ? null : crossrefResult;

  if (!csl && !crossref) {
    return { doi, error: `Metadata unavailable (DOI service: ${cslResult.__error}; Crossref: ${crossrefResult.__error})` };
  }

  const crossrefDate = chooseDate(null, crossref);
  const date = chooseDate(csl, crossref);
  const cslAuthors = Array.isArray(csl?.author) ? csl.author : [];
  const crossrefAuthors = Array.isArray(crossref?.author) ? crossref.author : [];
  const authors = cslAuthors.length ? cslAuthors : crossrefAuthors;
  const references = Array.isArray(crossref?.reference)
    ? crossref.reference.map(normalizeReference)
    : [];

  return {
    doi,
    url: `https://doi.org/${encodeURI(doi)}`,
    title: firstText(csl?.title) || firstText(crossref?.title) || "Title unavailable",
    journal: firstText(csl?.["container-title"]) || firstText(crossref?.["container-title"]) || "Publication name unavailable",
    authors,
    authorNames: authors.map(authorName).filter(Boolean),
    date,
    citationCount: Number.isFinite(Number(crossref?.["is-referenced-by-count"]))
      ? Number(crossref["is-referenced-by-count"]) : null,
    referenceCount: Number.isFinite(Number(crossref?.["references-count"]))
      ? Number(crossref["references-count"]) : references.length,
    references,
    sourceWarnings: [
      cslResult?.__error ? `DOI metadata service: ${cslResult.__error}` : "",
      crossrefResult?.__error ? `Crossref: ${crossrefResult.__error}` : ""
    ].filter(Boolean),
    crossrefDate
  };
}

async function mapLimit(items, limit, task, onDone) {
  const output = new Array(items.length);
  let next = 0;
  let completed = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try { output[index] = await task(items[index]); }
      catch (error) { output[index] = { doi: items[index], error: error.message || String(error) }; }
      completed++;
      onDone?.(completed, items.length, output[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function formatDate(date) {
  if (!date) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric", month: "long", day: date.getUTCDate() === 1 ? undefined : "numeric",
    timeZone: "UTC"
  }).format(date);
}

function formatShortDate(date) {
  if (!date) return "Unknown date";
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", timeZone: "UTC" }).format(date);
}

function renderChart() {
  const plotted = publications.filter(p => !p.error && p.date && p.citationCount !== null);
  const missing = publications.length - plotted.length;

  if (!plotted.length) {
    chartEl.innerHTML = '<div class="empty-state">No records had both a usable publication date and citation count. Check the API status and console for details.</div>';
    summaryEl.textContent = `${publications.length} DOI entries`;
    return;
  }

  const trace = {
    type: "scatter",
    mode: "markers",
    x: plotted.map(p => p.date.toISOString()),
    y: plotted.map(p => p.citationCount),
    customdata: plotted.map(p => [p.doi, p.authorNames[0] || "Author unavailable", p.journal, p.title, formatDate(p.date)]),
    marker: {
      size: plotted.map(p => p.doi === selectedDoi ? 13 : 9),
      color: plotted.map(p => p.doi === selectedDoi ? "#d05a36" : "#176b87"),
      opacity: 0.82,
      line: { color: "#ffffff", width: 1 }
    },
    hovertemplate:
      "<b>%{customdata[3]}</b><br>" +
      "Date: %{customdata[4]}<br>" +
      "Lead author: %{customdata[1]}<br>" +
      "Publication: %{customdata[2]}<br>" +
      "Citations: %{y:,}<extra></extra>"
  };

  const layout = {
    autosize: true,
    margin: { l: 72, r: 24, t: 18, b: 72 },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    font: { family: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif", color: "#263640" },
    xaxis: {
      title: { text: "Publication date", standoff: 12 },
      type: "date",
      showgrid: true,
      gridcolor: "#e8edf0",
      zeroline: false,
      tickformat: "%Y"
    },
    yaxis: {
      title: { text: "Citations received (Crossref)", standoff: 12 },
      rangemode: "tozero",
      showgrid: true,
      gridcolor: "#e8edf0",
      zeroline: false
    },
    hoverlabel: { bgcolor: "#17232d", font: { color: "#ffffff", size: 12 }, align: "left" },
    showlegend: false
  };

  Plotly.react(chartEl, [trace], layout, {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"]
  });

  chartEl.on("plotly_click", event => {
    const point = event.points?.[0];
    const doi = point?.customdata?.[0];
    if (doi) selectPublication(doi);
  });

  summaryEl.textContent = `${plotted.length} plotted · ${publications.length} unique DOIs${missing ? ` · ${missing} missing/incomplete` : ""}`;
}

function renderDetails(pub) {
  if (!pub) {
    detailsEl.className = "empty-state";
    detailsEl.textContent = "No publication selected yet.";
    return;
  }
  if (pub.error) {
    detailsEl.className = "empty-state";
    detailsEl.innerHTML = `<strong>${escapeHtml(pub.doi)}</strong><p>${escapeHtml(pub.error)}</p>`;
    return;
  }

  const authorText = pub.authorNames.length ? pub.authorNames.join("; ") : "Author list unavailable";
  const refsMarkup = pub.references.length
    ? `<ol class="references">${pub.references.map(ref => {
        const label = [ref.title, ref.journal, ref.year].filter(Boolean).join(" · ");
        return `<li>${ref.url
          ? `<a href="${escapeHtml(ref.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label || ref.doi)}</a>`
          : `${escapeHtml(label)} <span class="badge">No DOI deposited</span>`}
          ${ref.doi ? `<div class="muted">DOI: ${escapeHtml(ref.doi)}</div>` : ""}
        </li>`;
      }).join("")}</ol>`
    : `<p class="muted">No reference list was available in Crossref metadata for this paper.</p>`;

  detailsEl.className = "";
  detailsEl.innerHTML = `
    <div class="detail-grid">
      <div class="detail-main">
        <span class="badge">${escapeHtml(formatShortDate(pub.date))}</span>
        <h3 class="article-title">${escapeHtml(pub.title)}</h3>
        <p class="meta-line">${escapeHtml(pub.authorNames[0] || "Lead author unavailable")} · ${escapeHtml(pub.journal)} · ${escapeHtml(formatDate(pub.date))}</p>
        <dl>
          <dt>DOI link</dt><dd><a class="doi-link" href="${escapeHtml(pub.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(pub.doi)}</a></dd>
          <dt>Publication name</dt><dd>${escapeHtml(pub.journal)}</dd>
          <dt>Article name</dt><dd>${escapeHtml(pub.title)}</dd>
          <dt>Author list</dt><dd class="author-list">${escapeHtml(authorText)}</dd>
        </dl>
        <h3>References cited by this paper</h3>
        ${refsMarkup}
      </div>
      <aside class="detail-side">
        <div class="count-card">
          <span class="count-number">${pub.citationCount === null ? "—" : pub.citationCount.toLocaleString()}</span>
          <span class="count-label">External citations recorded by Crossref</span>
        </div>
        <dl>
          <dt>References deposited</dt><dd>${pub.referenceCount ?? "Unavailable"}</dd>
          <dt>References with DOI</dt><dd>${pub.references.filter(ref => ref.doi).length}</dd>
        </dl>
        ${pub.sourceWarnings.length ? `<p class="muted">${pub.sourceWarnings.map(escapeHtml).join(" · ")}</p>` : ""}
      </aside>
    </div>`;
}

function selectPublication(doi) {
  selectedDoi = doi;
  const pub = publications.find(item => item.doi === doi);
  renderDetails(pub);
  renderChart();
  document.getElementById("details-heading").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function main() {
  try {
    const response = await fetch(DOI_LIST_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load ${DOI_LIST_URL} (HTTP ${response.status}).`);
    const raw = await response.text();
    const seen = new Set();
    const dois = [];
    const duplicates = [];
    for (const line of raw.split(/\r?\n/)) {
      const candidate = line.trim();
      if (!candidate || candidate.startsWith("#")) continue;
      const doi = cleanDoi(candidate);
      if (!/^10\.\d{4,9}\//i.test(doi)) {
        duplicates.push(`Invalid DOI format: ${candidate}`);
        continue;
      }
      const key = doi.toLowerCase();
      if (seen.has(key)) { duplicates.push(doi); continue; }
      seen.add(key);
      dois.push(doi);
    }

    if (!dois.length) throw new Error("No valid DOIs were found in dois.txt.");
    setStatus(`Loaded ${dois.length} unique DOIs. Fetching bibliographic metadata and citation counts…`);

    publications = await mapLimit(dois, CONCURRENCY, fetchOne, (done, total, result) => {
      setStatus(`Fetching metadata: ${done} of ${total}${result?.error ? ` · issue with ${result.doi}` : ""}`);
    });

    const successful = publications.filter(p => !p.error).length;
    const plotted = publications.filter(p => !p.error && p.date && p.citationCount !== null).length;
    const failed = publications.length - successful;
    const missing = publications.filter(p => !p.error && (!p.date || p.citationCount === null)).length;
    renderChart();
    setStatus(
      `Finished: ${successful}/${publications.length} records retrieved; ${plotted} have both a date and citation count.` +
      (duplicates.length ? ` Skipped ${duplicates.length} duplicate or invalid line(s).` : "") +
      (failed ? ` ${failed} DOI(s) failed both metadata sources.` : "") +
      (missing ? ` ${missing} record(s) have incomplete plot data.` : "")
    );
    if (failed) statusEl.classList.add("error");
  } catch (error) {
    setStatus(`${error.message} If opening the page directly from disk, run it through GitHub Pages or a local web server so the browser can fetch dois.txt.`, true);
    summaryEl.textContent = "Unable to load";
  }
}

main();
