import "server-only";
import nodemailer from "nodemailer";
import { formatDate } from "@/lib/format";
import { readSettings } from "@/lib/settings";
import {
  BANNER_CID,
  BRAND,
  bannerAttachment,
  buildPosters,
  cidPosterSrc,
  renderIssueHtml,
  renderIssueText,
} from "./email";
import type { Edition, Issue } from "./types";

/**
 * SMTP delivery.
 *
 * Sending is OFF unless NEWSLETTER_ENABLED is set, even with SMTP configured.
 * Issues still generate and appear on the dashboard, so the first few can be
 * read before anything reaches someone else's mailbox — a newsletter is the
 * one feature here where a bad first attempt is visible to other people.
 */

const SEND_TIMEOUT_MS = 30_000;

export interface MailConfig {
  host: string | null;
  port: number;
  secure: boolean;
  user: string | null;
  pass: string | null;
  from: string | null;
  viewerRecipients: string[];
  adminRecipients: string[];
  enabled: boolean;
  configured: boolean;
}

function recipients(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter((address) => address.includes("@"));
}

function envValue(name: string): string | null {
  return process.env[name]?.trim() || null;
}

/**
 * Stored settings take precedence over the environment.
 *
 * The other way round would mean a value saved in the UI silently does
 * nothing whenever the same variable happens to be set in .env.local — a
 * form that appears to work and doesn't is worse than no form. The settings
 * panel says which fields the environment also defines, so the override is
 * visible rather than mysterious.
 */
export async function mailConfig(): Promise<MailConfig> {
  const stored = (await readSettings()).mail;

  const host = stored.host ?? envValue("SMTP_HOST");
  const user = stored.user ?? envValue("SMTP_USER");

  const envPort = Number(process.env.SMTP_PORT);
  const port =
    stored.port ?? (Number.isFinite(envPort) && envPort > 0 ? envPort : 587);

  const viewer = stored.viewerRecipients ?? process.env.NEWSLETTER_RECIPIENTS;
  const admin = stored.adminRecipients ?? process.env.NEWSLETTER_ADMIN_RECIPIENTS;

  return {
    host,
    port,
    // 465 is implicit TLS; 587 upgrades with STARTTLS. Getting this backwards
    // is the most common reason a first SMTP attempt hangs.
    secure: stored.secure ?? (process.env.SMTP_SECURE?.trim() === "1" || port === 465),
    user,
    pass: stored.pass ?? envValue("SMTP_PASS"),
    from: stored.from ?? envValue("SMTP_FROM") ?? user,
    viewerRecipients: recipients(viewer ?? undefined),
    adminRecipients: recipients(admin ?? undefined),
    enabled: stored.enabled ?? process.env.NEWSLETTER_ENABLED?.trim() === "1",
    configured: Boolean(host),
  };
}

/** Which fields the environment defines, so the UI can say so. */
export function envDefinedMailFields(): string[] {
  return (
    [
      ["host", "SMTP_HOST"],
      ["port", "SMTP_PORT"],
      ["user", "SMTP_USER"],
      ["pass", "SMTP_PASS"],
      ["from", "SMTP_FROM"],
      ["viewerRecipients", "NEWSLETTER_RECIPIENTS"],
      ["adminRecipients", "NEWSLETTER_ADMIN_RECIPIENTS"],
      ["enabled", "NEWSLETTER_ENABLED"],
    ] as const
  )
    .filter(([, variable]) => Boolean(process.env[variable]?.trim()))
    .map(([field]) => field);
}

function dashboardUrl(): string | null {
  const raw = process.env.DASHBOARD_URL?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return `${raw.replace(/\/+$/, "")}/newsletter`;
  } catch {
    return null;
  }
}

export interface SendOutcome {
  ok: boolean;
  message: string;
  sent: number;
}

/**
 * Sends one edition.
 *
 * `to` overrides the configured recipients, which is how the test send reaches
 * only the person who pressed the button.
 */
export async function sendIssue(
  issue: Issue,
  edition: Edition,
  to?: string[],
): Promise<SendOutcome> {
  const config = await mailConfig();

  if (!config.configured || !config.from) {
    return { ok: false, message: "SMTP isn't configured. Set SMTP_HOST and SMTP_FROM.", sent: 0 };
  }

  const audience =
    to ?? (edition === "admin" ? config.adminRecipients : config.viewerRecipients);

  if (audience.length === 0) {
    return {
      ok: false,
      message: `No ${edition} recipients configured.`,
      sent: 0,
    };
  }

  try {
    const transport = nodemailer.createTransport({
      host: config.host!,
      port: config.port,
      secure: config.secure,
      auth: config.user && config.pass ? { user: config.user, pass: config.pass } : undefined,
      connectionTimeout: SEND_TIMEOUT_MS,
      greetingTimeout: SEND_TIMEOUT_MS,
      socketTimeout: SEND_TIMEOUT_MS,
    });

    const { attachments, cids } = await buildPosters(issue.shared.added);
    const banner = await bannerAttachment();

    const subject =
      edition === "admin"
        ? `${BRAND} — week of ${formatDate(issue.from)}`
        : issue.shared.added.length > 0
          ? `New on ${BRAND} — ${formatDate(issue.to)}`
          : `${BRAND} — ${formatDate(issue.to)}`;

    await transport.sendMail({
      from: config.from,
      // Recipients go in BCC so a viewer newsletter doesn't disclose everyone
      // else's address to everyone on the list.
      to: config.from,
      bcc: audience,
      subject,
      text: renderIssueText(issue, edition),
      html: renderIssueHtml(issue, edition, {
        posterSrc: cidPosterSrc(cids),
        dashboardUrl: dashboardUrl(),
        bannerSrc: banner ? `cid:${BANNER_CID}` : null,
      }),
      attachments: [...(banner ? [banner] : []), ...attachments].map((file) => ({
        filename: file.filename,
        content: file.content,
        cid: file.cid,
        contentDisposition: "inline" as const,
      })),
    });

    return {
      ok: true,
      message: `Sent the ${edition} edition to ${audience.length} ${
        audience.length === 1 ? "recipient" : "recipients"
      }.`,
      sent: audience.length,
    };
  } catch (error) {
    // The SMTP server's own complaint is far more useful than anything this
    // code could invent — bad credentials, blocked port and TLS mismatch all
    // say so explicitly.
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      sent: 0,
    };
  }
}
