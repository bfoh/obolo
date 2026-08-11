"use client";

import { LogOut } from "lucide-react";
import { useTransition } from "react";
import { signOut } from "@/app/(auth)/actions";

export function SignOutButton() {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => startTransition(() => signOut())}
      aria-label="Sign out"
      className="flex h-9 w-9 items-center justify-center border-2 border-bitumen-700 text-concrete-300 transition-colors hover:text-signal-400 disabled:opacity-50"
    >
      <LogOut size={16} aria-hidden />
    </button>
  );
}
