import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface px-5 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="font-display text-5xl font-extrabold tracking-tight text-ink">OBOLO</h1>
          <p className="micro mt-2">Warehouse stock and valuation</p>
        </div>

        <div className="rule bg-panel p-6">
          <LoginForm next={next} />
        </div>
      </div>
    </main>
  );
}
