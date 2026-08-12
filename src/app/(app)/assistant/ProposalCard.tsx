"use client";

import { Check, X } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/Button";
import { confirmProposal, type ConfirmState } from "./actions";

function Confirm() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      <Check size={15} aria-hidden />
      {pending ? "Recording…" : "Yes, do it"}
    </Button>
  );
}

/**
 * What the assistant is offering to do.
 *
 * Deliberately not styled as a result. The wording is future tense and the
 * action is a button, because nothing has happened yet and the person reading
 * it is the one deciding whether it will. The model produced the description;
 * the press is what reaches the ledger.
 */
export function ProposalCard({
  tool,
  summary,
  input,
}: {
  tool: string;
  summary: string;
  input: Record<string, unknown>;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [state, formAction] = useActionState<ConfirmState, FormData>(confirmProposal, {
    error: null,
  });

  if (dismissed && !state.done) {
    return (
      <p className="rule bg-panel px-4 py-2.5 text-sm text-ink-3">
        Left alone — nothing was recorded.
      </p>
    );
  }

  if (state.done) {
    return (
      <p className="border-2 border-tally bg-tally-soft px-4 py-2.5 text-sm text-tally" role="status">
        {state.done}
      </p>
    );
  }

  return (
    <form action={formAction} className="border-2 border-transit bg-transit-soft p-4">
      <input type="hidden" name="tool" value={tool} />
      <input type="hidden" name="input" value={JSON.stringify(input)} />

      <p className="micro text-transit">Confirm before this is recorded</p>
      <p className="mt-2 text-sm text-ink">{summary}</p>

      {state.error ? (
        <p role="alert" className="mt-3 border-2 border-signal bg-signal-soft px-3 py-2 text-sm text-signal">
          {state.error}
        </p>
      ) : null}

      <div className="mt-4 flex gap-2">
        <Confirm />
        <Button type="button" variant="secondary" onClick={() => setDismissed(true)}>
          <X size={15} aria-hidden />
          No
        </Button>
      </div>
    </form>
  );
}
