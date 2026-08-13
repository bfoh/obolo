"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { describePasswordProblem } from "@/lib/password";

export interface SignInState {
  error: string | null;
}

export interface PasswordState {
  error: string | null;
}

/** Only same-origin paths, so `?next=` cannot be used as an open redirect. */
function safeNext(next: FormDataEntryValue | null): string {
  const value = typeof next === "string" ? next : "";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Deliberately does not distinguish "no such account" from "wrong
    // password" -- that difference tells an attacker which emails are real.
    return { error: "Those details did not match an account." };
  }

  revalidatePath("/", "layout");
  redirect(safeNext(formData.get("next")));
}

/**
 * Changes the signed-in person's own password.
 *
 * Supabase's `updateUser({ password })` trusts the session alone, so the
 * current password is verified first by signing in with it. Without that,
 * anyone who walks up to an unlocked phone on the warehouse floor owns the
 * account -- and these are shared devices in practice.
 *
 * The database never sees a password. GoTrue holds it; all `set_password_changed`
 * does is record that the person has now chosen one themselves.
 */
export async function changePassword(
  _prev: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { error: "You are not signed in." };

  const current = String(formData.get("current_password") ?? "");
  const next = String(formData.get("new_password") ?? "");
  const confirm = String(formData.get("confirm_password") ?? "");

  if (current.length === 0) return { error: "Enter your current password." };

  const problem = describePasswordProblem(next, confirm, current);
  if (problem) return { error: problem };

  const { error: wrongCurrent } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: current,
  });
  if (wrongCurrent) return { error: "That is not your current password." };

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) {
    // Supabase enforces its own policy on top of ours -- length, and any
    // strength requirement set on the project. Pass its wording through rather
    // than replacing it with a guess.
    return { error: error.message };
  }

  const { error: flagError } = await supabase.rpc("set_password_changed");
  if (flagError) {
    // The password did change, so saying otherwise would be wrong. But the
    // flag still stands, and the layout will send them straight back here.
    return { error: "Your password changed, but the app could not record it. Try signing in again." };
  }

  revalidatePath("/", "layout");
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
