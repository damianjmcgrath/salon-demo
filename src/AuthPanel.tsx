import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
export default function AuthPanel({
  db,
  recovery = false,
  onComplete,
  onBrowse,
}: {
  db: SupabaseClient;
  recovery?: boolean;
  onComplete: () => void;
  onBrowse: () => void;
}) {
  const [mode, setMode] = useState<"signin" | "signup" | "reset">("signin");
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [name, setName] = useState(""),
    [phone, setPhone] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (recovery) {
        if (password !== confirm) throw Error("The passwords do not match.");
        const r = await db.auth.updateUser({ password });
        if (r.error) throw r.error;
        await db.auth.signOut();
        onComplete();
        return;
      }
      if (mode === "reset") {
        const r = await db.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + window.location.pathname,
        });
        if (r.error) throw r.error;
        setMessage(
          "If an account exists for this address, a reset link will be sent. Open it to choose a new password.",
        );
        return;
      }
      if (mode === "signup") {
        const r = await db.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin + window.location.pathname,
            data: { full_name: name.trim(), mobile: phone.trim() },
          },
        });
        if (r.error) throw r.error;
        if (r.data.session) onComplete();
        else {
          setMessage("Check your email to confirm your account, then sign in.");
          setPassword("");
          setMode("signin");
        }
        return;
      }
      const r = await db.auth.signInWithPassword({ email, password });
      if (r.error) throw r.error;
      setPassword("");
      onComplete();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel login">
      <p className="eyebrow">SCULPTED · YOUR WORKSPACE</p>
      <h1>
        {recovery
          ? "Choose a new password."
          : mode === "signup"
            ? "Make yourself at home."
            : mode === "reset"
              ? "Let’s get you back in."
              : "Welcome back."}
      </h1>
      <p className="small">
        {recovery
          ? "Enter your new password below."
          : mode === "signup"
            ? "Create a client account to book and view your appointments."
            : "One secure sign-in. The right workspace for your role."}
      </p>
      <form onSubmit={(e) => void submit(e)}>
        {mode === "signup" && !recovery && (
          <>
            <label>
              Full name
              <input
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Mobile number
              <input
                autoComplete="tel"
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
          </>
        )}
        {!recovery && (
          <label>
            Email address
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
        )}
        {(recovery || mode !== "reset") && (
          <label>
            Password
            <input
              type="password"
              autoComplete={
                recovery || mode === "signup"
                  ? "new-password"
                  : "current-password"
              }
              minLength={recovery || mode === "signup" ? 8 : undefined}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
        {recovery && (
          <label>
            Confirm new password
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
        )}
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="auth-message">
            {message}
          </p>
        )}
        <button className="primary" disabled={busy} type="submit">
          {busy
            ? "Please wait…"
            : recovery
              ? "Save new password"
              : mode === "signup"
                ? "Create client account"
                : mode === "reset"
                  ? "Send reset link"
                  : "Sign in"}
        </button>
      </form>
      {!recovery && (
        <div className="auth-links">
          <button
            onClick={() => {
              setMode(mode === "signup" ? "signin" : "signup");
              setError("");
              setMessage("");
              setPassword("");
            }}
          >
            {mode === "signup"
              ? "Already registered? Sign in"
              : "New client? Create an account"}
          </button>
          <button
            onClick={() => {
              setMode(mode === "reset" ? "signin" : "reset");
              setError("");
              setMessage("");
              setPassword("");
            }}
          >
            {mode === "reset" ? "Back to sign in" : "Forgot password?"}
          </button>
          <button onClick={onBrowse}>Browse treatments first →</button>
        </div>
      )}
      <p className="small">
        Staff, owner, accountant and IT access is assigned by the salon. New
        registrations always start as clients.
      </p>
    </section>
  );
}
