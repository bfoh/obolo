import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { AssistantChat } from "./AssistantChat";

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
