"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { describePasswordProblem, MIN_PASSWORD_LENGTH } from "@/lib/password";
import { changePassword, type PasswordState } from "../actions";

const field =
  "w-full border-2 border-line bg-panel-2 px-3 py-2.5 text-ink outline-none focus-visible:border-focus";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="press mt-6 w-full rule bg-ink px-4 py-3 font-display text-sm font-bold uppercase tracking-wider text-ink-invert disabled:opacity-60"
    >
      {pending ? "Saving…" : "Save password"}
    </button>
  );
}

export function PasswordForm({ forced }: { forced: boolean }) {
  const [state, formAction] = useActionState<PasswordState, FormData>(changePassword, {
    error: null,
  });

  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  // Shown while typing, but only once there is something to judge -- flagging
  // "too short" against an empty field is noise, not help. The server checks
  // the same rule again; this just saves the round trip.
  const live = next.length > 0 && confirm.length > 0 ? describePasswordProblem(next, confirm) : null;

  return (
    <form action={formAction} className="mt-5" noValidate>
      <label htmlFor="current_password" className="micro mb-2 block">
        Current password
      </label>
      <input
        id="current_password"
        name="current_password"
        type="password"
        autoComplete="current-password"
        required
        className={field}
      />

      <label htmlFor="new_password" className="micro mt-4 mb-2 block">
        New password
      </label>
      <input
        id="new_password"
        name="new_password"
        type="password"
        autoComplete="new-password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        value={next}
        onChange={(event) => setNext(event.target.value)}
        aria-describedby="new_password_hint"
        className={field}
      />
      <p id="new_password_hint" className="mt-1.5 text-xs text-ink-3">
        At least {MIN_PASSWORD_LENGTH} characters.
      </p>

      <label htmlFor="confirm_password" className="micro mt-4 mb-2 block">
        Repeat new password
      </label>
      <input
        id="confirm_password"
        name="confirm_password"
        type="password"
        autoComplete="new-password"
        required
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
        className={field}
      />

      {state.error ?? live ? (
        <p
          role="alert"
          aria-live="polite"
          className="mt-4 border-2 border-signal bg-signal-soft px-3 py-2 text-sm text-signal"
        >
          {state.error ?? live}
        </p>
      ) : null}

      <SubmitButton />

      {/* No way back while it is forced -- there is nowhere else to be. */}
      {forced ? null : (
        <Link
          href="/"
          className="mt-4 block text-center text-sm text-ink-3 underline-offset-4 hover:text-ink hover:underline"
        >
          Back to the app
        </Link>
      )}
    </form>
  );
}
