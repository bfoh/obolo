"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { signIn, type SignInState } from "../actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="press mt-6 w-full rule bg-ink px-4 py-3 font-display text-sm font-bold uppercase tracking-wider text-ink-invert disabled:opacity-60"
    >
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}

export function LoginForm({ next }: { next: string }) {
  const [state, formAction] = useActionState<SignInState, FormData>(signIn, { error: null });

  return (
    <form action={formAction} noValidate>
      <input type="hidden" name="next" value={next} />

      <label htmlFor="email" className="micro mb-2 block">
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        className="w-full border-2 border-line bg-panel-2 px-3 py-2.5 text-ink outline-none focus-visible:border-focus"
      />

      <label htmlFor="password" className="micro mt-4 mb-2 block">
        Password
      </label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        className="w-full border-2 border-line bg-panel-2 px-3 py-2.5 text-ink outline-none focus-visible:border-focus"
      />

      {state.error ? (
        // aria-live so the failure is announced, not just shown.
        <p role="alert" aria-live="polite" className="mt-4 border-2 border-signal bg-signal-soft px-3 py-2 text-sm text-signal">
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
