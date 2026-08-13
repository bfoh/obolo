import type { Metadata } from "next";
import dynamicImport from "next/dynamic";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";

/**
 * The chat is loaded on its own, after the shell.
 *
 * `@ai-sdk/react` is 268 KB and made this route's first load 776 KB against
 * ~508 KB everywhere else. It does not leak into the shared bundle, so the cost
 * was only ever paid here -- but it was paid before anything rendered. Split
 * out, the header and the waiting state paint immediately and the chat arrives
 * behind them, which on a bad line is the difference between a blank screen and
 * a page that is visibly getting ready.
 */
const AssistantChat = dynamicImport(
  () => import("./AssistantChat").then((m) => m.AssistantChat),
  {
    loading: () => (
      <div className="px-5 py-6">
        <div className="rule h-32 animate-pulse bg-panel" aria-hidden />
        <p className="sr-only">Loading the assistant</p>
      </div>
    ),
  },
);

export const metadata: Metadata = { title: "Assistant" };
export const dynamic = "force-dynamic";

export default async function AssistantPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <>
      <PageHeader title="Assistant" code="Ask about stock · confirm before anything is recorded" />
      <AssistantChat name={user.fullName.split(" ")[0]} />
    </>
  );
}
