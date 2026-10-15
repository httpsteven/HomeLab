import "server-only";
import nodemailer from "nodemailer";
import { formatDate } from "@/lib/format";
import { buildPosters, cidPosterSrc, renderIssueHtml, renderIssueText } from "./email";
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

export function mailConfig(): MailConfig {
  const host = process.env.SMTP_HOST?.trim() || null;
  const rawPort = Number(process.env.SMTP_PORT);
  const port = Number.isFinite(rawPort) && rawPort > 0 ? rawPort : 587;
  const user = process.env.SMTP_USER?.trim() || null;

  return {
    host,
    port,
    // 465 is implicit TLS; 587 upgrades with STARTTLS. Getting this backwards
    // is the most common reason a first SMTP attempt hangs.
    secure: process.env.SMTP_SECURE?.trim() === "1" || port === 465,
    user,
    pass: process.env.SMTP_PASS?.trim() || null,
    from: process.env.SMTP_FROM?.trim() || user,
    viewerRecipients: recipients(process.env.NEWSLETTER_RECIPIENTS),
    adminRecipients: recipients(process.env.NEWSLETTER_ADMIN_RECIPIENTS),
    enabled: process.env.NEWSLETTER_ENABLED?.trim() === "1",
    configured: Boolean(host),
  };
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
  const config = mailConfig();

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

    const subject =
      edition === "admin"
        ? `Home Lab — week of ${formatDate(issue.from)}`
        : issue.shared.added.length > 0
          ? `New on the server — ${formatDate(issue.to)}`
          : `Home Lab — ${formatDate(issue.to)}`;

    await transport.sendMail({
      from: config.from,
      // Recipients go in BCC so a viewer newsletter doesn't disclose everyone
      // else's address to everyone on the list.
      to: config.from,
      bcc: audience,
      subject,
      text: renderIssueText(issue, edition),
      html: renderIssueHtml(issue, edition, cidPosterSrc(cids), dashboardUrl()),
      attachments: attachments.map((poster) => ({
        filename: poster.filename,
        content: poster.content,
        cid: poster.cid,
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
