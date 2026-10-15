import "server-only";
import { formatBytes, formatDate, formatNumber } from "@/lib/format";
import type { Edition, Issue } from "./types";
import { BANNER_CID, BANNER_URL, bannerAttachment } from "./banner";
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
 *
 * DARK BY DESIGN. Not a preference — a light email gets auto-inverted by
 * Gmail and Outlook on a dark phone, and their inversion is a blunt channel
 * flip that wrecks poster art and turns careful greys to mud. Shipping dark to
 * begin with means most clients leave it alone. `color-scheme` tells the ones
 * that read it not to touch anything; the few that invert regardless now have
 * less to ruin, because nothing here depends on a white background.
 *
 * Every foreground/background pair below was measured, not eyeballed: the
 * lowest is faint text on the inner surface at 4.69:1.
 */

const PAGE_BG = "#0b0b0d";
const CARD_BG = "#141417";
const SURFACE = "#1c1c20";
const INK = "#f2f2f0";
const SECONDARY = "#c9c9c6";
const MUTED = "#a3a3a8";
const FAINT = "#86868c";
const LINE = "#26262c";
/** Lavender, pulled out of the masthead gradient. 7.14:1 on the card. */
const ACCENT = "#b78bff";
const ALERT = "#ff7a82";
const ALERT_BG = "#2a1618";
const WIDTH = 600;

export const BRAND = "stevenplex";

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
  <tr><td style="padding:26px 22px 0 22px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr>
        <td style="font:600 11px/1.4 ${FONT};letter-spacing:.1em;text-transform:uppercase;color:${FAINT};white-space:nowrap;padding-bottom:14px;">
          ${escapeHtml(title)}
        </td>
        <!-- A rule that starts where the label ends, rather than a border the
             label sits on top of — Outlook renders this reliably. -->
        <td width="100%" style="padding:0 0 14px 10px;">
          <div style="height:1px;background:${LINE};font-size:0;line-height:0;">&nbsp;</div>
        </td>
      </tr>
    </table>
    ${inner}
  </td></tr>`;
}

function addedRows(issue: Issue, posterSrc: PosterSrc): string {
  if (issue.shared.added.length === 0) {
    return `<div style="font:400 14px/1.5 ${FONT};color:${MUTED};padding:4px 0 2px;">Nothing new this week.</div>`;
  }

  return issue.shared.added
    .slice(0, 12)
    .map((item) => {
      const src = posterSrc(item);
      const poster = src
        ? `<img src="${escapeHtml(src)}" width="72" height="108" alt="" style="display:block;width:72px;height:108px;border-radius:8px;border:0;outline:none;text-decoration:none;background:${SURFACE};" />`
        : // No poster: a lettered tile rather than a gap, since a missing
          // image in a grid of images reads as breakage.
          `<div style="width:72px;height:108px;border-radius:8px;background:#26262c;font:600 26px/108px ${FONT};color:${FAINT};text-align:center;">${escapeHtml(
            item.title.charAt(0).toUpperCase(),
          )}</div>`;

      const meta = [item.subtitle, item.kind === "show" ? "TV" : "Film"]
        .filter(Boolean)
        .join(" · ");

      return `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${SURFACE}" style="background:${SURFACE};border-radius:12px;margin-bottom:10px;">
        <tr>
          <td width="96" valign="top" style="padding:12px 0 12px 12px;">${poster}</td>
          <td valign="top" style="padding:12px 14px 12px 12px;">
            <div style="font:600 15px/1.35 ${FONT};color:${INK};">${escapeHtml(item.title)}</div>
            <div style="font:400 12px/1.5 ${FONT};color:${FAINT};padding-top:3px;">${escapeHtml(meta)}</div>
            ${
              item.summary
                ? `<div style="font:400 13px/1.55 ${FONT};color:${MUTED};padding-top:7px;">${escapeHtml(
                    truncate(item.summary, 170),
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
    <td style="font:400 13px/1.3 ${FONT};color:${MUTED};padding:9px 0;border-bottom:1px solid ${LINE};">${escapeHtml(label)}</td>
    <td align="right" style="font:600 13px/1.3 ${FONT};color:${SECONDARY};padding:9px 0;border-bottom:1px solid ${LINE};white-space:nowrap;">${escapeHtml(value)}</td>
  </tr>`;
}

function statTable(rows: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}</table>`;
}

/**
 * The figures under the masthead.
 *
 * Laid out as table cells rather than inline-blocks: Outlook ignores
 * `display:inline-block` on a div, and these are the first thing in the email.
 */
function statStrip(entries: { value: string; label: string }[]): string {
  if (entries.length === 0) return "";

  // Equal columns, stated as a percentage: left to auto-size, the cell holding
  // "+1014.27 GB" takes half the strip and the figures stop lining up.
  const width = `${Math.floor(100 / entries.length)}%`;

  return `
  <tr><td style="padding:18px 22px 4px 22px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="table-layout:fixed;">
      <tr>
        ${entries
          .map(
            (entry) => `
        <td class="stat" align="center" valign="top" width="${width}" bgcolor="${SURFACE}" style="width:${width};background:${SURFACE};border-radius:10px;padding:12px 4px;">
          <div style="font:700 18px/1.15 ${FONT};color:${INK};white-space:nowrap;">${escapeHtml(entry.value)}</div>
          <div style="font:600 10px/1.4 ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${FAINT};padding-top:5px;">${escapeHtml(
            entry.label,
          )}</div>
        </td>
        ${entry === entries[entries.length - 1] ? "" : `<td width="8" style="font-size:0;line-height:0;">&nbsp;</td>`}`,
          )
          .join("")}
      </tr>
    </table>
  </td></tr>`;
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

export interface RenderOptions {
  posterSrc: PosterSrc;
  dashboardUrl: string | null;
  /** `cid:…` in a real send, an http path in the preview, null if absent. */
  bannerSrc: string | null;
}

export function renderIssueHtml(
  issue: Issue,
  edition: Edition,
  options: RenderOptions,
): string {
  const { posterSrc, dashboardUrl, bannerSrc } = options;
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

  const stats = [
    shared.counts.movies > 0
      ? { value: formatNumber(shared.counts.movies), label: "Films" }
      : null,
    shared.counts.episodes > 0
      ? { value: formatNumber(shared.counts.episodes), label: "Episodes" }
      : null,
    { value: formatNumber(shared.totalPlays), label: "Plays" },
    // Space added is an admin figure: it says what the library costs, which is
    // the operator's business and not a viewer's.
    edition === "admin" && admin.bytesAdded !== null
      ? { value: `+${formatBytes(admin.bytesAdded)}`, label: "Added" }
      : null,
  ].filter((entry): entry is { value: string; label: string } => entry !== null);

  const body: string[] = [statStrip(stats)];

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
                `<div style="font:400 13px/1.6 ${FONT};color:${ALERT};padding:9px 12px;background:${ALERT_BG};border-left:3px solid ${ALERT};border-radius:0 8px 8px 0;margin-bottom:6px;">${escapeHtml(
                  text,
                )}</div>`,
            )
            .join(""),
        ),
      );
    }
  }

  const range = `${escapeHtml(formatDate(issue.from))} – ${escapeHtml(formatDate(issue.to))}`;

  const masthead = bannerSrc
    ? `<img src="${escapeHtml(bannerSrc)}" width="${WIDTH}" alt="${escapeHtml(BRAND)}" style="display:block;width:100%;max-width:${WIDTH}px;height:auto;border:0;outline:none;text-decoration:none;" />`
    : // No banner file: a typographic masthead, which also covers the client
      // that blocks images outright.
      `<div style="font:700 26px/1.2 ${FONT};letter-spacing:-.02em;color:${INK};padding:30px 22px 0 22px;">${escapeHtml(
        BRAND,
      )}</div>`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<!-- Tells the clients that read it this email is already dark, so they skip
     their own inversion pass. -->
<meta name="color-scheme" content="dark" />
<meta name="supported-color-schemes" content="dark" />
<title>${escapeHtml(BRAND)} — ${escapeHtml(formatDate(issue.to))}</title>
<style>
  :root { color-scheme: dark; supported-color-schemes: dark; }
  /* Phones: the poster column is fine, but the stat strip wants room. */
  @media only screen and (max-width:480px) {
    .stat { display:block !important; width:100% !important; margin-bottom:6px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${PAGE_BG};" bgcolor="${PAGE_BG}">
<!-- Preheader: the grey line of text clients show beside the subject. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(
    headline || "Nothing new this week.",
  )}</div>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${PAGE_BG}" style="background:${PAGE_BG};">
<tr><td align="center" style="padding:26px 12px;">

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${WIDTH}" bgcolor="${CARD_BG}" style="width:100%;max-width:${WIDTH}px;background:${CARD_BG};border-radius:16px;overflow:hidden;border:1px solid ${LINE};">

    <tr><td style="font-size:0;line-height:0;">${masthead}</td></tr>

    <tr><td style="padding:16px 22px 0 22px;">
      <div style="font:600 12px/1.5 ${FONT};letter-spacing:.06em;text-transform:uppercase;color:${FAINT};">
        ${range}${headline ? ` &nbsp;·&nbsp; ${escapeHtml(headline)}` : ""}
      </div>
    </td></tr>

    ${body.join("")}

    <tr><td style="padding:28px 22px 24px 22px;">
      ${
        dashboardUrl
          ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              <td bgcolor="${SURFACE}" style="background:${SURFACE};border-radius:10px;">
                <a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;padding:11px 18px;font:600 13px/1 ${FONT};color:${ACCENT};text-decoration:none;">Open the dashboard &rarr;</a>
              </td></tr></table>`
          : ""
      }
      <div style="font:400 11px/1.6 ${FONT};color:${FAINT};padding-top:18px;margin-top:18px;border-top:1px solid ${LINE};">
        Generated ${escapeHtml(formatDate(issue.generatedAt))} by ${escapeHtml(BRAND)}.
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
    `${BRAND.toUpperCase()} — ${formatDate(issue.from)} to ${formatDate(issue.to)}`,
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

export { BANNER_CID, BANNER_URL, bannerAttachment, buildPosters };
