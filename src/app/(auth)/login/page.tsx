import type { Metadata } from "next";
import { GyeNyame } from "@/components/brand/GyeNyame";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface px-5 py-12">
      <div className="w-full max-w-sm">
        {/* Centred as a block: the mark and wordmark stay a single unit, and
            the strapline centres under the pair rather than under the word. */}
        <div className="mb-8 text-center">
          <div className="flex items-center justify-center gap-3.5">
            <GyeNyame className="h-12 w-auto shrink-0 text-ink" title="Gye Nyame" />
            <h1 className="font-display text-5xl font-extrabold tracking-tight text-ink">OBOLO</h1>
          </div>
          <p className="micro mt-3">Warehouse stock and valuation</p>
        </div>

        <div className="rule bg-panel p-6">
          <LoginForm next={next} />
        </div>
      </div>
    </main>
  );
}
