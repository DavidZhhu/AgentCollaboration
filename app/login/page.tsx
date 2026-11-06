"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Layers, ArrowRight, LockKeyhole, Eye, EyeOff } from "lucide-react";
import "../workspace.css";
import { readApiResponse } from "../api-response";
export default function Login() {
  const [mode, setMode] = useState("login"),
    [token, setToken] = useState(""),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [visible, setVisible] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const setup = params.get("setup"),
      invite = params.get("invite");
    if (setup) {
      setMode("setup");
      setToken(setup);
    }
    if (invite) {
      setMode("invite");
      setToken(invite);
      fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "inspect_invite", token: invite }),
      })
        .then(async (response) => {
          const data = (await readApiResponse(response)) as any;
          if (!response.ok) throw new Error(data.error);
          setName(data.username);
        })
        .catch((e) => setError(e.message));
    }
  }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    if (mode !== "login" && fields.password !== fields.confirm) {
      setError("The passwords do not match.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action:
            mode === "setup"
              ? "setup"
              : mode === "invite"
                ? "accept_invite"
                : "login",
          token,
          username: name,
          ...fields,
        }),
      });
      const data = (await readApiResponse(response)) as any;
      if (!response.ok) throw new Error(data.error);
      window.location.replace(mode === "invite" || new URLSearchParams(window.location.search).get("next") === "setup" ? "/setup" : "/");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="login-page">
      <a className="brand" href="/login">
        <span>
          <Layers size={24} />
        </span>
        agent<span className="brand-light">collab</span>
      </a>
      <section className="login-card">
        <span className="login-lock">
          <LockKeyhole size={22} />
        </span>
        <div className="eyebrow">YOUR TEAM, IN SYNC</div>
        <h1>
          {mode === "setup"
            ? "Set up your owner account"
            : mode === "invite"
              ? "You’re invited to the team"
              : "Welcome back"}
        </h1>
        <p>
          {mode === "login"
            ? "Sign in with your workspace username and password."
            : mode === "invite"
              ? `Set your own password for ${name || "your invited username"}.`
              : "Choose the username and password you’ll use to manage this workspace."}
        </p>
        <form onSubmit={submit}>
          <label>
            Username
            <input
              name="username"
              value={name}
              onChange={(e) => setName(e.target.value)}
              readOnly={mode === "invite"}
              required
              autoComplete="username"
              pattern={"[a-zA-Z0-9][a-zA-Z0-9_.\\-]{2,31}"}
              placeholder="Your username"
            />
          </label>
          <label>
            Password
            <div className="password-input">
              <input
                name="password"
                type={visible ? "text" : "password"}
                required
                minLength={mode === "login" ? undefined : 12}
                maxLength={128}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                placeholder={
                  mode === "login" ? "Your password" : "At least 12 characters"
                }
              />
              <button
                type="button"
                aria-label={visible ? "Hide password" : "Show password"}
                onClick={() => setVisible(!visible)}
              >
                {visible ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>
          {mode !== "login" && (
            <label>
              Confirm password
              <input
                name="confirm"
                type="password"
                required
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
              />
            </label>
          )}
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <button
            className="primary form-submit"
            disabled={saving || (mode === "invite" && !name)}
          >
            {saving
              ? "Please wait…"
              : mode === "login"
                ? "Sign in"
                : "Set password and continue"}
            <ArrowRight size={15} />
          </button>
        </form>
        <div className="login-footnote">
          {mode === "login"
            ? "Need an account or a password reset? Ask your workspace owner for an invitation link."
            : "Your invitation is private. Choose a password you don’t use elsewhere."}
        </div>
      </section>
      <p><Link href="/help">New here? Read the user guide</Link></p>
      <small className="login-caption">
        A shared home for your agent team.
      </small>
    </div>
  );
}
