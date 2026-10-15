"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Mail, Send, Sparkles } from "lucide-react";
import { ActionButton } from "@/components/ui/ActionButton";
import { MailSettings } from "@/components/panels/MailSettings";
import {
  BentoColumns,
  NotConfigured,
  Panel,
  PanelBody,
  PanelHeader,
} from "@/components/ui/Panel";
import { InfoNote, StatusBadge } from "@/components/ui/Status";
import { formatBytes, formatDate, formatNumber } from "@/lib/format";
import type { AddedItem, Issue, IssueSummary } from "@/lib/newsletter/types";

/**
 * The newsletter page.
 *
 * Renders the ADMIN view — this is the dashboard, behind whatever protects
 * it. The viewer edition is what goes out by mail, and the split lives in the
 * issue model rather than in a flag here.
 *
 * Two deliberate columns rather than a wrapping grid, for the reason the
 * overview page gives: the issue is one very tall tile and everything beside
 * it is short, so a row-based layout leaves the entire right side empty below
 * Delivery. The split is by subject — the left column is the issue itself, the
 * right is everything that governs where it goes.
 */

interface Payload {
  issue: Issue | null;
  archive: IssueSummary[];
  mail: {
    configured: boolean;
    enabled: boolean;
    viewerRecipients: number;
    adminRecipients: number;
  };
}

function Poster({ item }: { item: AddedItem }) {
  if (!item.thumb) {
    return (
      <div
        className="grid h-[108px] w-[72px] shrink-0 place-items-center rounded-lg text-lg font-semibold text-white/70"
        style={{ background: "linear-gradient(150deg, var(--surface-3), var(--surface-2))" }}
        aria-hidden
      >
        {item.title.charAt(0).toUpperCase()}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/image?img=${encodeURIComponent(item.thumb)}&w=144&h=216`}
      alt=""
      className="h-[108px] w-[72px] shrink-0 rounded-lg object-cover"
      loading="lazy"
    />
  );
}

export function NewsletterView({ issueId }: { issueId?: string }) {
  const [data, setData] = useState<Payload | null>(null);

  const load = useCallback(() => {
    const query = issueId ? `?id=${encodeURIComponent(issueId)}` : "";
    return fetch(`/api/newsletter${query}`)
      .then((response) => response.json())
      .then((payload: Payload) => setData(payload))
      .catch(() => {});
  }, [issueId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) {
    return (
      <Panel span="full">
        <PanelBody>
          <div className="skeleton h-64 w-full" />
        </PanelBody>
      </Panel>
    );
  }

  const { issue, archive, mail } = data;

  // No issue yet still shows the settings — this is exactly when you want to
  // fill them in.
  if (!issue) {
    return (
      <BentoColumns
        primary={
          <Panel>
            <PanelHeader title="No issues yet" icon={<Mail size={13} />} />
            <PanelBody className="flex flex-col items-start gap-3">
              <p className="max-w-prose text-sm leading-relaxed text-ink-muted">
                An issue is generated once a week. Build one now to see what it looks
                like — nothing is emailed unless you&apos;ve turned sending on.
              </p>
              <ActionButton
                action="newsletter.generate"
                label="Generate an issue"
                icon={<Sparkles size={12} aria-hidden />}
                onDone={load}
              />
            </PanelBody>
          </Panel>
        }
        secondary={<MailSettings onSaved={load} />}
      />
    );
  }

  const { shared, admin } = issue;
  const issueQuery = issueId ? `&id=${encodeURIComponent(issueId)}` : "";

  return (
    <BentoColumns
      primary={
        <Panel>
          <PanelHeader
            title="New this week"
            meta={`${formatDate(issue.from)} – ${formatDate(issue.to)}`}
            icon={<Mail size={13} />}
            action={
              <ActionButton
                action="newsletter.generate"
                label="Rebuild"
                size="xs"
                icon={<Sparkles size={10} aria-hidden />}
                onDone={load}
              />
            }
          />
          <PanelBody className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              {[
                { label: "Films", value: shared.counts.movies },
                { label: "Episodes", value: shared.counts.episodes },
                { label: "Shows", value: shared.counts.shows },
                { label: "Plays", value: shared.totalPlays },
              ].map((stat) => (
                <div key={stat.label} className="rounded-lg bg-surface-2 px-3 py-2">
                  <p className="metric text-lg leading-none font-semibold text-ink">
                    {formatNumber(stat.value)}
                  </p>
                  <p className="label-muted mt-1">{stat.label}</p>
                </div>
              ))}
              {admin.bytesAdded !== null ? (
                <div className="rounded-lg bg-surface-2 px-3 py-2">
                  <p className="metric text-lg leading-none font-semibold text-ink">
                    +{formatBytes(admin.bytesAdded)}
                  </p>
                  <p className="label-muted mt-1">Added</p>
                </div>
              ) : null}
            </div>

            {shared.added.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-muted">Nothing new this week.</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {shared.added.slice(0, 20).map((item) => (
                  <li key={item.key} className="flex gap-3 rounded-xl bg-surface-2 p-3">
                    <Poster item={item} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">{item.title}</p>
                      <p className="metric mt-0.5 text-[11px] text-ink-faint">
                        {[item.subtitle, item.kind === "show" ? "TV" : "Film"]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {item.summary ? (
                        <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-ink-muted">
                          {item.summary}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </PanelBody>
        </Panel>
      }
      secondary={
        <>
          {/* --- Delivery ---------------------------------------------- */}
          <Panel>
            <PanelHeader title="Delivery" icon={<Send size={13} />} />
            <PanelBody className="flex flex-col gap-3">
              {!mail.configured ? (
                <NotConfigured
                  service="SMTP"
                  hint="Fill in the email settings below to mail issues out."
                />
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge
                      level={mail.enabled ? "good" : "unknown"}
                      label={mail.enabled ? "Sending on" : "Sending off"}
                      compact
                    />
                    <span className="metric text-[11px] text-ink-faint">
                      {mail.viewerRecipients} viewer · {mail.adminRecipients} admin
                    </span>
                  </div>

                  {!mail.enabled ? (
                    <InfoNote>
                      Issues are generated and archived, but nothing is emailed until you
                      turn sending on below. Read a couple here first — this is the one
                      feature whose mistakes land in other people&apos;s inboxes.
                    </InfoNote>
                  ) : null}

                  <TestSend />
                </>
              )}

              {/* Opens the real email renderer, not a lookalike. */}
              <div className="flex flex-wrap gap-3 border-t border-[var(--glass-border)] pt-3">
                {(["admin", "viewer"] as const).map((edition) => (
                  <a
                    key={edition}
                    href={`/api/newsletter/preview?edition=${edition}${issueQuery}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-ink-muted transition-colors hover:text-ink"
                  >
                    <ExternalLink size={10} aria-hidden />
                    Preview {edition} email
                  </a>
                ))}
              </div>
            </PanelBody>
          </Panel>

          {/* --- Settings ---------------------------------------------- */}
          <MailSettings onSaved={load} />

          {/* --- Archive ----------------------------------------------- */}
          {archive.length > 0 ? (
            <Panel>
              <PanelHeader title="Archive" meta={`${archive.length}`} />
              <PanelBody>
                <ul className="flex flex-col gap-1">
                  {archive.slice(0, 12).map((entry) => (
                    <li key={entry.id}>
                      <Link
                        href={`/newsletter/${entry.id}`}
                        className="flex items-baseline justify-between gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-surface-2"
                      >
                        <span className="text-ink-secondary">{formatDate(entry.to)}</span>
                        <span className="metric text-[11px] text-ink-faint">
                          {entry.movies} films · {entry.episodes} eps
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </PanelBody>
            </Panel>
          ) : null}
        </>
      }
    />
  );
}

/**
 * A test send goes to ONE typed address, never the configured lists — the
 * whole point is to see the email yourself before anyone else does.
 */
function TestSend() {
  const [to, setTo] = useState("");
  const [edition, setEdition] = useState<"admin" | "viewer">("admin");

  return (
    <div className="flex flex-col gap-2 border-t border-[var(--glass-border)] pt-3">
      <p className="label-muted">Send a test</p>
      <div className="flex rounded-lg bg-surface-2 p-0.5">
        {(["admin", "viewer"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setEdition(value)}
            className={`flex-1 rounded-md px-2 py-1 text-xs font-medium capitalize transition-colors ${
              edition === value ? "bg-surface-3 text-ink" : "text-ink-muted hover:text-ink-secondary"
            }`}
          >
            {value}
          </button>
        ))}
      </div>
      <input
        type="email"
        value={to}
        onChange={(event) => setTo(event.target.value)}
        placeholder="you@example.com"
        aria-label="Test recipient address"
        className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink placeholder:text-ink-faint focus:outline-none"
      />
      <ActionButton
        action="newsletter.sendTest"
        params={{ to, edition }}
        label="Send test"
        size="xs"
        icon={<Send size={10} aria-hidden />}
      />
    </div>
  );
}
