import { LoginForm } from "@/components/LoginForm";
import { authConfigured } from "@/lib/auth";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

/**
 * The only page reachable without a session.
 *
 * Reached by redirect from the proxy, so it has to say nothing about what
 * lies behind it — no service names, no counts, nothing that would make an
 * unauthenticated visitor's time worthwhile.
 */
export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-16">
      <div className="glass w-full max-w-sm rounded-2xl p-6 sm:p-7">
        <h1 className="text-lg font-semibold text-ink">Home Lab</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {authConfigured()
            ? "Sign in to continue."
            : "No password is set, so there is nothing to sign in to."}
        </p>
        {authConfigured() ? <LoginForm /> : null}
      </div>
    </main>
  );
}
