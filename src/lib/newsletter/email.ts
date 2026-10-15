import "server-only";
import { formatBytes, formatDate, formatNumber } from "@/lib/format";
import type { Edition, Issue } from "./types";
import { buildPosters } from "./posters";

/**
 * The email edition.
 *
 * Hand-written table HTML with inline styles, deliberately. Mail clients do
 * not reliably support flexbox, grid, CSS custom properties or external
 * stylesheets — Outlook still renders through Word's HTML engine — so none of
 * the dashboard's components or design tokens can be reused here. Attempting
 * to share them is the usual way a feature like this looks perfect in a
 * browser and arrives broken.
 *
 * Colours are therefore literal hex, duplicated from the dashboard palette on
 * purpose rather than imported.
 */

const INK = "#1a1a1d";
const MUTED = "#6b6b75";
const FAINT = "#9d9c95";
const LINE = "#e4e4e7";
const ACCENT = "#c9313c";
const PAGE_BG = "#f4f4f5";
const CARD_BG = "#ffffff";
const WIDTH = 600;

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Everything user-supplied goes through this before reaching the HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

function section(title: string, inner: string): string {
  return `
  <tr><td style="padding:28px 24px 0 24px;">
    <div style="font:600 11px/1.4 ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${FAINT};padding-bottom:12px;">
      ${escapeHtml(title)}
    </div>
    ${inner}
  </td></tr>`;
}

function addedRows(issue: Issue, posterSrc: PosterSrc): string {
  if (issue.shared.added.length === 0) {
    return `<div style="font:400 14px/1.5 ${FONT};color:${MUTED};">Nothing new this week.</div>`;
  }

  return issue.shared.added
    .slice(0, 12)
    .map((item) => {
      const src = posterSrc(item);
      const poster = src
        ? `<img src="${escapeHtml(src)}" width="72" alt="" style="display:block;border-radius:6px;border:0;outline:none;text-decoration:none;" />`
        : // No poster: a lettered tile rather than a gap, since a missing
          // image in a grid of images reads as breakage.
          `<div style="width:72px;height:108px;border-radius:6px;background:${PAGE_BG};font:600 24px/108px ${FONT};color:${FAINT};text-align:center;">${escapeHtml(
            item.title.charAt(0).toUpperCase(),
          )}</div>`;

      const meta = [item.subtitle, item.kind === "show" ? "TV" : "Film"]
        .filter(Boolean)
        .join(" · ");

      return `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:14px;">
        <tr>
          <td width="84" valign="top" style="padding-right:12px;">${poster}</td>
          <td valign="top">
            <div style="font:600 15px/1.35 ${FONT};color:${INK};">${escapeHtml(item.title)}</div>
            <div style="font:400 12px/1.5 ${FONT};color:${FAINT};padding-top:2px;">${escapeHtml(meta)}</div>
            ${
              item.summary
                ? `<div style="font:400 13px/1.55 ${FONT};color:${MUTED};padding-top:6px;">${escapeHtml(
                    truncate(item.summary, 180),
                  )}</div>`
                : ""
            }
          </td>
        </tr>
      </table>`;
    })
    .join("");
}

function statRow(label: string, value: string): string {
  return `
  <tr>
    <td style="font:400 13px/1.8 ${FONT};color:${MUTED};">${escapeHtml(label)}</td>
    <td align="right" style="font:600 13px/1.8 ${FONT};color:${INK};">${escapeHtml(value)}</td>
  </tr>`;
}

function statTable(rows: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}</table>`;
}

/**
 * Resolves an item's poster to an <img src>.
 *
 * Email returns `cid:…` referencing an attachment; the browser preview returns
 * the dashboard's own proxy URL. Passing this in rather than a CID map is what
 * lets one renderer serve both without the preview being a separate,
 * drifting copy of the template.
 */
export type PosterSrc = (item: { key: string; thumb: string | null }) => string | null;

export function cidPosterSrc(cids: Map<string, string>): PosterSrc {
  return (item) => {
    const cid = cids.get(item.key);
    return cid ? `cid:${cid}` : null;
  };
}

/** Preview only — these URLs are reachable from a browser, not from a mailbox. */
export const proxyPosterSrc: PosterSrc = (item) =>
  item.thumb ? `/api/image?img=${encodeURIComponent(item.thumb)}&w=220&h=330` : null;

export function renderIssueHtml(
  issue: Issue,
  edition: Edition,
  posterSrc: PosterSrc,
  dashboardUrl: string | null,
): string {
  const { shared, admin } = issue;

  const headline = [
    shared.counts.movies > 0
      ? `${shared.counts.movies} ${shared.counts.movies === 1 ? "film" : "films"}`
      : null,
    shared.counts.episodes > 0
      ? `${shared.counts.episodes} ${shared.counts.episodes === 1 ? "episode" : "episodes"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const body: string[] = [];

  body.push(section("New this week", addedRows(issue, posterSrc)));

  if (shared.topTitles.length > 0) {
    body.push(
      section(
        "Most watched",
        statTable(
          shared.topTitles
            .map((row) => statRow(row.label, `${formatNumber(row.plays)} plays`))
            .join(""),
        ),
      ),
    );
  }

  /* --- Admin-only sections -------------------------------------------
     Gated on the edition, and sourced from issue.admin, which the viewer
     edition simply never reads. */
  if (edition === "admin") {
    const lines: string[] = [];
    if (admin.bytesAdded !== null) {
      lines.push(statRow("Library growth", `+${formatBytes(admin.bytesAdded)}`));
    }
    if (admin.libraryBytesNow !== null) {
      lines.push(statRow("Library size", formatBytes(admin.libraryBytesNow)));
    }
    lines.push(statRow("Total plays", formatNumber(shared.totalPlays)));
    body.push(section("The numbers", statTable(lines.join(""))));

    if (admin.storage.length > 0) {
      body.push(
        section(
          "Storage",
          statTable(
            admin.storage
              .map((mount) =>
                statRow(
                  `${mount.label} (${mount.path})`,
                  `${Math.round(mount.usedFraction * 100)}% · ${formatBytes(mount.free)} free`,
                ),
              )
              .join(""),
          ),
        ),
      );
    }

    if (admin.topUsers.length > 0) {
      body.push(
        section(
          "Top users",
          statTable(
            admin.topUsers
              .map((row) => statRow(row.label, `${formatNumber(row.plays)} plays`))
              .join(""),
          ),
        ),
      );
    }

    const problems = [
      ...admin.servicesDown.map((name) => `${name} is unreachable`),
      ...admin.issues.map((issueRow) => `${issueRow.service}: ${issueRow.message}`),
    ];
    if (problems.length > 0) {
      body.push(
        section(
          "Needs attention",
          problems
            .slice(0, 8)
            .map(
              (text) =>
                `<div style="font:400 13px/1.6 ${FONT};color:${INK};padding:6px 10px;background:#fdf4f4;border-left:3px solid ${ACCENT};margin-bottom:6px;">${escapeHtml(
                  text,
                )}</div>`,
            )
            .join(""),
        ),
      );
    }
  }

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Home Lab — ${escapeHtml(formatDate(issue.to))}</title>
</head>
<body style="margin:0;padding:0;background:${PAGE_BG};">
<!-- Preheader: the grey line of text clients show beside the subject. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(
    headline || "Nothing new this week.",
  )}</div>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${PAGE_BG};">
<tr><td align="center" style="padding:24px 12px;">

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${WIDTH}" style="width:100%;max-width:${WIDTH}px;background:${CARD_BG};border-radius:12px;overflow:hidden;">

    <tr><td style="padding:28px 24px 0 24px;border-bottom:1px solid ${LINE};padding-bottom:20px;">
      <div style="font:700 20px/1.3 ${FONT};color:${INK};">Home Lab</div>
      <div style="font:400 13px/1.5 ${FONT};color:${FAINT};padding-top:4px;">
        ${escapeHtml(formatDate(issue.from))} – ${escapeHtml(formatDate(issue.to))}${
          headline ? ` · ${escapeHtml(headline)}` : ""
        }
      </div>
    </td></tr>

    ${body.join("")}

    <tr><td style="padding:28px 24px 24px 24px;">
      ${
        dashboardUrl
          ? `<a href="${escapeHtml(dashboardUrl)}" style="font:600 13px/1 ${FONT};color:${ACCENT};text-decoration:none;">Open the dashboard →</a>`
          : ""
      }
      <div style="font:400 11px/1.6 ${FONT};color:${FAINT};padding-top:14px;border-top:1px solid ${LINE};margin-top:18px;">
        Generated ${escapeHtml(formatDate(issue.generatedAt))} by your home lab.
      </div>
    </td></tr>

  </table>

</td></tr>
</table>
</body></html>`;
}

/**
 * Plain-text alternative.
 *
 * Not an afterthought: some clients prefer it, some people force it, and spam
 * filters treat an HTML-only multipart message with suspicion.
 */
export function renderIssueText(issue: Issue, edition: Edition): string {
  const lines: string[] = [
    `HOME LAB — ${formatDate(issue.from)} to ${formatDate(issue.to)}`,
    "",
    "NEW THIS WEEK",
  ];

  if (issue.shared.added.length === 0) {
    lines.push("  Nothing new this week.");
  } else {
    for (const item of issue.shared.added.slice(0, 20)) {
      lines.push(`  • ${item.title}${item.subtitle ? ` (${item.subtitle})` : ""}`);
    }
  }

  if (issue.shared.topTitles.length > 0) {
    lines.push("", "MOST WATCHED");
    for (const row of issue.shared.topTitles) lines.push(`  ${row.label} — ${row.plays} plays`);
  }

  if (edition === "admin") {
    lines.push("", "THE NUMBERS");
    if (issue.admin.bytesAdded !== null) {
      lines.push(`  Library growth: +${formatBytes(issue.admin.bytesAdded)}`);
    }
    lines.push(`  Total plays: ${issue.shared.totalPlays}`);

    if (issue.admin.storage.length > 0) {
      lines.push("", "STORAGE");
      for (const mount of issue.admin.storage) {
        lines.push(
          `  ${mount.label} (${mount.path}) — ${Math.round(mount.usedFraction * 100)}%, ${formatBytes(mount.free)} free`,
        );
      }
    }

    const problems = [
      ...issue.admin.servicesDown.map((name) => `${name} is unreachable`),
      ...issue.admin.issues.map((row) => `${row.service}: ${row.message}`),
    ];
    if (problems.length > 0) {
      lines.push("", "NEEDS ATTENTION");
      for (const text of problems.slice(0, 8)) lines.push(`  ! ${text}`);
    }
  }

  return lines.join("\n");
}

export { buildPosters };
