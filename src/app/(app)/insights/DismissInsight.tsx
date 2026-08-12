"use client";

import { X } from "lucide-react";
import { useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { dismissInsight } from "./actions";

export function DismissInsight({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="quiet"
      size="sm"
      disabled={pending}
      aria-label="Dismiss this insight"
      onClick={() => start(() => dismissInsight(id))}
    >
      <X size={15} aria-hidden />
    </Button>
  );
}
