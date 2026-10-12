// Builds a client-facing PDF audit report from a data file.
//
// Reusable for future clients: edit report/audit-data.json (or pass another
// file) and re-run. This script renders a self-contained HTML document and then
// prints it to PDF with headless Chrome.
//
// Usage:
//   node report/build.mjs [data.json] [output-basename]
//   CHROME_BIN=/path/to/chrome node report/build.mjs
//
// Output: report/<basename>.html and report/<basename>.pdf

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const dataPath = resolve(process.argv[2] ?? join(here, "audit-data.json"));
const base = process.argv[3] ?? "audit-report";
const htmlPath = join(here, `${base}.html`);
const pdfPath = join(here, `${base}.pdf`);

const d = JSON.parse(readFileSync(dataPath, "utf8"));
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const SEV = {
  Critical: "#7a1020", High: "#b23b2e", Medium: "#b7791f", Low: "#4a6b8a", Informational: "#5a6b5a",
};
const sevBadge = (s) => `<span class="badge" style="background:${SEV[s] ?? "#555"}">${esc(s)}</span>`;
const statusClass = (s) => (/^fixed$/i.test(s) ? "ok" : /partial/i.test(s) ? "part" : "rec");

const counts = d.executiveSummary.counts;
const countRow = Object.entries(counts)
  .map(([k, v]) => `<div class="count"><div class="cn" style="color:${SEV[k] ?? "#555"}">${v}</div><div class="cl">${esc(k)}</div></div>`)
  .join("");

const repoUrl = (d.meta.repoUrl || "").replace(/\/+$/, "");
const commitLink = (h) => (repoUrl ? `<a href="${repoUrl}/commit/${esc(h)}">${esc(h.slice(0, 7))}</a>` : `<code>${esc(h.slice(0, 7))}</code>`);

function remediationBlock(f) {
  if (/recommendation/i.test(f.status)) {
    const steps = (f.howToFix || []).map((s) => `<li>${esc(s)}</li>`).join("");
    return `<h3>How to fix</h3><ol>${steps}</ol>`;
  }
  const files = (f.files || []).map((p) => `<code>${esc(p)}</code>`).join(", ");
  const commits = (f.commits || []).map(commitLink).join(", ");
  const where = [files && `Files: ${files}`, commits && `Commit: ${commits}`].filter(Boolean).join("<br>");
  const remains = f.whatRemains ? `<h3>What remains</h3><p>${esc(f.whatRemains)}</p>` : "";
  return `
    <h3>What we changed</h3>
    <p>${esc(f.whatChanged)}</p>
    <h3>Where</h3>
    <p class="where">${where || "-"}</p>
    <h3>How we verified it</h3>
    <p>${esc(f.howVerified)}</p>
    ${remains}`;
}

const findingPages = d.findings
  .map(
    (f, i) => `
  <section class="page finding">
    <div class="fhead">
      <div class="fid">${esc(f.id)} ${sevBadge(f.severity)}</div>
      <div class="fstatus ${statusClass(f.status)}">${esc(f.status)}</div>
    </div>
    <h2>${esc(f.title)}</h2>
    <h3>What was found</h3>
    <p>${esc(f.found)}</p>
    <h3>Why it matters for the business</h3>
    <p>${esc(f.impact)}</p>
    ${remediationBlock(f)}
    <div class="fnum">Finding ${i + 1} of ${d.findings.length}</div>
  </section>`,
  )
  .join("");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(d.meta.title)} - ${esc(d.meta.app)}</title>
<style>
  :root { --accent: ${d.meta.accentColor || "#9a5b3a"}; }
  * { box-sizing: border-box; }
  @page { size: A4; margin: 18mm 16mm; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font: 11pt/1.5 -apple-system, "Helvetica Neue", Arial, sans-serif; color: #1a1a1a; margin: 0; }
  h1,h2,h3 { color: #111; line-height: 1.25; }
  h2 { font-size: 16pt; margin: 0 0 10px; }
  h3 { font-size: 10.5pt; text-transform: uppercase; letter-spacing: .04em; color: var(--accent); margin: 16px 0 4px; }
  p { margin: 0 0 8px; }
  .page { page-break-before: always; }
  .badge { color: #fff; font-size: 8.5pt; font-weight: 700; padding: 2px 7px; border-radius: 10px; vertical-align: middle; }
  /* Cover */
  .cover { page-break-before: avoid; height: 245mm; display: flex; flex-direction: column; }
  .cover .bar { height: 10px; background: var(--accent); margin-bottom: 40mm; }
  .cover .kicker { color: var(--accent); font-weight: 700; letter-spacing: .12em; text-transform: uppercase; font-size: 10pt; }
  .cover h1 { font-size: 30pt; margin: 8px 0 4px; }
  .cover .app { font-size: 14pt; color: #444; margin: 0 0 2px; }
  .cover .sub { font-size: 12pt; color: #666; }
  .cover .meta { margin-top: auto; color: #555; font-size: 10pt; border-top: 1px solid #ddd; padding-top: 10px; }
  .cover .conf { color: var(--accent); font-weight: 600; }
  /* Summary */
  .counts { display: flex; gap: 14px; margin: 14px 0 16px; }
  .count { border: 1px solid #e3e3e3; border-radius: 8px; padding: 10px 14px; text-align: center; min-width: 70px; }
  .count .cn { font-size: 22pt; font-weight: 700; }
  .count .cl { font-size: 8.5pt; color: #666; text-transform: uppercase; letter-spacing: .03em; }
  ul { margin: 4px 0 10px; padding-left: 18px; }
  li { margin: 3px 0; }
  .callout { background: #faf5f1; border-left: 3px solid var(--accent); padding: 8px 12px; border-radius: 4px; margin: 10px 0; }
  /* Finding */
  .fhead { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--accent); padding-bottom: 6px; margin-bottom: 10px; }
  .fid { font-weight: 700; font-size: 12pt; }
  .fstatus { font-size: 9pt; font-weight: 700; padding: 3px 9px; border-radius: 10px; }
  .fstatus.ok { background: #e6f4ea; color: #1e7a3b; }
  .fstatus.part { background: #fff4e0; color: #9a6400; }
  .fstatus.rec { background: #eef2f7; color: #3a5a7a; }
  .fnum { position: running; margin-top: 18px; color: #999; font-size: 8.5pt; }
  table { width: 100%; border-collapse: collapse; font-size: 10pt; margin: 8px 0; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e3e3e3; vertical-align: top; }
  th { color: var(--accent); text-transform: uppercase; font-size: 8.5pt; letter-spacing: .03em; }
  .muted { color: #666; font-size: 9.5pt; }
  .where { font-size: 9.5pt; line-height: 1.7; }
  a { color: var(--accent); text-decoration: none; }
  code { background: #f2f0ee; padding: 1px 4px; border-radius: 3px; font-size: 9pt; word-break: break-all; }
</style></head>
<body>

  <section class="cover">
    <div class="bar"></div>
    <div class="kicker">${esc(d.meta.kicker || "")}</div>
    <h1>${esc(d.meta.title)}</h1>
    <div class="app">${esc(d.meta.app)}</div>
    <div class="sub">${esc(d.meta.subtitle)}</div>
    <div class="meta">
      <div>${esc(d.meta.date)}</div>
      <div class="conf">${esc(d.meta.coverLabel)}</div>
      <div>${esc(d.meta.preparedBy)}</div>
    </div>
  </section>

  <section class="page">
    <h2>Executive summary</h2>
    <p>${esc(d.executiveSummary.intro)}</p>
    <div class="counts">${countRow}</div>
    <p>${esc(d.executiveSummary.foundationNote)}</p>
    <p>${esc(d.executiveSummary.theme)}</p>
    <div class="callout">${esc(d.executiveSummary.outcome)}</div>
    <h3>The biggest risks in plain terms</h3>
    <ul>${d.executiveSummary.topRisks.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
    <p class="muted">${esc(d.executiveSummary.testRun)}</p>
  </section>

  <section class="page">
    <h2>What was done well</h2>
    <p>Not everything needed fixing. These are the parts the app already got right:</p>
    <ul>${d.strengths.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
    <h3>Additional hardening applied</h3>
    <ul>${d.hardening.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
  </section>

  ${findingPages}

  <section class="page">
    <h2>Remediation roadmap</h2>
    <p>Recommended order for the work still outstanding.</p>
    <table>
      <tr><th>#</th><th>Action</th><th>Addresses</th><th>Effort</th></tr>
      ${d.roadmap.map((r) => `<tr><td>${esc(r.priority)}</td><td>${esc(r.item)}</td><td>${esc(r.addresses)}</td><td>${esc(r.effort)}</td></tr>`).join("")}
    </table>
  </section>

  <section class="page">
    <h2>Scope and how to re-run the tests</h2>
    <h3>Scope</h3>
    <p>${esc(d.scope)}</p>
    <h3>Re-running the tests</h3>
    <p>${esc(d.reproduce.intro)}</p>
    <ul>${d.reproduce.envVars.map((v) => `<li><code>${esc(v)}</code></li>`).join("")}</ul>
    <ol>${d.reproduce.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
  </section>

</body></html>`;

writeFileSync(htmlPath, html);
console.log("wrote", htmlPath);

function findChrome() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  return candidates.find((p) => existsSync(p));
}

const chrome = findChrome();
if (!chrome) {
  console.log("No Chrome/Chromium found. Set CHROME_BIN, or print", htmlPath, "to PDF manually.");
  process.exit(0);
}
const tmpProfile = join(here, ".chrome-profile");
execFileSync(chrome, [
  "--headless",
  "--disable-gpu",
  "--no-first-run",
  "--no-pdf-header-footer",
  `--user-data-dir=${tmpProfile}`,
  `--print-to-pdf=${pdfPath}`,
  `file://${htmlPath}`,
], { stdio: "inherit" });
console.log("wrote", pdfPath);
