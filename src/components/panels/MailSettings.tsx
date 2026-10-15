"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Save, Settings2 } from "lucide-react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { InfoNote } from "@/components/ui/Status";

/**
 * Mail settings, editable from the dashboard.
 *
 * Everything else in this project is configured by environment variable, which
 * is the right default for something self-hosted. Mail is the exception
 * because it's the one thing you tune by trial and error — a wrong port or a
 * rejected app password is three container rebuilds otherwise.
 *
 * Two things this form does NOT do, both deliberate:
 *
 *   - It never receives the password. The GET returns `hasPassword`, not a
 *     value and not a masked value, because a masked secret is still a secret
 *     that left the server. Leaving the field empty keeps whatever is stored.
 *   - It doesn't hide that the environment also sets some of these. A field
 *     the env defines is labelled, because "I set SMTP_HOST and the form
 *     ignores it" is a genuinely confusing afternoon.
 */

interface MailPayload {
  host: string | null;
  port: number;
  secure: boolean;
  user: string | null;
  from: string | null;
  viewerRecipients: string;
  adminRecipients: string;
  enabled: boolean;
  hasPassword: boolean;
  storedFields: string[];
  envFields: string[];
}

interface FormState {
  host: string;
  port: string;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  viewerRecipients: string;
  adminRecipients: string;
  enabled: boolean;
}

function toForm(mail: MailPayload): FormState {
  return {
    host: mail.host ?? "",
    port: String(mail.port),
    secure: mail.secure,
    user: mail.user ?? "",
    // Always blank. See the note above.
    pass: "",
    from: mail.from ?? "",
    viewerRecipients: mail.viewerRecipients,
    adminRecipients: mail.adminRecipients,
    enabled: mail.enabled,
  };
}

export function MailSettings({ onSaved }: { onSaved?: () => void }) {
  const [mail, setMail] = useState<MailPayload | null>(null);
  const [form, setForm] = useState<FormState | null>(null);

  const load = useCallback(() => {
    fetch("/api/settings")
      .then((response) => response.json())
      .then((payload: { mail: MailPayload }) => {
        setMail(payload.mail);
        setForm(toForm(payload.mail));
      })
      .catch(() => {});
  }, []);

  useEffect(load, [load]);

  if (!mail || !form) {
    return (
      <Panel span="md">
        <PanelHeader title="Email settings" icon={<Settings2 size={13} />} />
        <PanelBody>
          <div className="skeleton h-48 w-full" />
        </PanelBody>
      </Panel>
    );
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => (current ? { ...current, [key]: value } : current));

  const fromEnv = (field: string) =>
    mail.envFields.includes(field) && !mail.storedFields.includes(field);

  return (
    <Panel span="md">
      <PanelHeader
        title="Email settings"
        icon={<Settings2 size={13} />}
        meta={mail.host ? mail.host : "not configured"}
      />
      <PanelBody className="flex flex-col gap-3">
        <Field
          label="SMTP host"
          value={form.host}
          onChange={(value) => set("host", value)}
          placeholder="smtp.gmail.com"
          env={fromEnv("host")}
        />

        <div className="flex gap-2">
          <div className="w-24">
            <Field
              label="Port"
              value={form.port}
              onChange={(value) => set("port", value)}
              placeholder="587"
              inputMode="numeric"
              env={fromEnv("port")}
            />
          </div>
          <div className="flex-1">
            <Toggle
              label="Implicit TLS"
              hint={form.secure ? "port 465 style" : "STARTTLS on 587"}
              checked={form.secure}
              onChange={(value) => set("secure", value)}
            />
          </div>
        </div>

        <Field
          label="Username"
          value={form.user}
          onChange={(value) => set("user", value)}
          placeholder="you@gmail.com"
          env={fromEnv("user")}
        />

        <Field
          label="Password"
          value={form.pass}
          onChange={(value) => set("pass", value)}
          type="password"
          autoComplete="new-password"
          placeholder={mail.hasPassword ? "•••••••• (unchanged)" : "app password"}
          icon={<KeyRound size={10} aria-hidden />}
          hint={
            mail.hasPassword
              ? "One is stored. Leave blank to keep it."
              : "Not set. Gmail and iCloud need an app password, not your login."
          }
        />

        <Field
          label="From address"
          value={form.from}
          onChange={(value) => set("from", value)}
          placeholder="lab@example.com"
          env={fromEnv("from")}
        />

        <Field
          label="Viewer recipients"
          value={form.viewerRecipients}
          onChange={(value) => set("viewerRecipients", value)}
          placeholder="friend@example.com, other@example.com"
          hint="Comma separated. These get the posters, nothing else."
          env={fromEnv("viewerRecipients")}
        />

        <Field
          label="Admin recipients"
          value={form.adminRecipients}
          onChange={(value) => set("adminRecipients", value)}
          placeholder="you@example.com"
          hint="These also get disk paths, free space and errors."
          env={fromEnv("adminRecipients")}
        />

        <Toggle
          label="Send weekly"
          hint={
            form.enabled
              ? "Issues go out on schedule."
              : "Issues generate and archive here, but nothing is mailed."
          }
          checked={form.enabled}
          onChange={(value) => set("enabled", value)}
        />

        <div className="flex items-center justify-between gap-2 border-t border-[var(--glass-border)] pt-3">
          <button
            type="button"
            onClick={load}
            className="text-[11px] text-ink-faint transition-colors hover:text-ink-secondary"
          >
            Discard changes
          </button>
          <ActionButton
            action="settings.mail"
            params={{ ...form, port: form.port }}
            label="Save settings"
            icon={<Save size={12} aria-hidden />}
            onDone={() => {
              load();
              onSaved?.();
            }}
          />
        </div>

        <InfoNote>
          Saved to <code className="metric">data/settings.json</code> and used in place of
          the matching environment variables. The dashboard has no login, so keep it on the
          tailnet now that it holds a password.
        </InfoNote>
      </PanelBody>
    </Panel>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
  type = "text",
  inputMode,
  autoComplete,
  icon,
  env,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  type?: "text" | "password";
  inputMode?: "numeric";
  autoComplete?: string;
  icon?: React.ReactNode;
  env?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="label-muted flex items-center gap-1.5">
        {icon}
        {label}
        {env ? (
          <span className="metric rounded bg-surface-3 px-1 py-px text-[9px] text-ink-faint">
            from env
          </span>
        ) : null}
      </span>
      <input
        type={type}
        value={value}
        inputMode={inputMode}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:ring-1 focus:ring-[var(--glass-border)]"
      />
      {hint ? <span className="text-[10px] leading-snug text-ink-faint">{hint}</span> : null}
    </label>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="label-muted">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-left"
      >
        <span
          aria-hidden
          className="relative h-4 w-7 shrink-0 rounded-full transition-colors"
          style={{ background: checked ? "var(--status-good)" : "var(--surface-3)" }}
        >
          <span
            className="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all"
            style={{ left: checked ? "14px" : "2px" }}
          />
        </span>
        <span className="text-xs text-ink-secondary">{checked ? "On" : "Off"}</span>
      </button>
      {hint ? <span className="text-[10px] leading-snug text-ink-faint">{hint}</span> : null}
    </div>
  );
}
