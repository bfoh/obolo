"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { AppSettingsRow } from "@/lib/data/types";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { updateSettings, type ActionState } from "./actions";

const field =
  "w-full border-2 border-line bg-panel-2 px-3 py-2.5 text-ink outline-none focus-visible:border-focus";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}

export function CompanyForm({ settings }: { settings: AppSettingsRow | null }) {
  const [state, formAction] = useActionState<ActionState, FormData>(updateSettings, { error: null });

  return (
    <form action={formAction}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="company_name" className="micro mb-2 block">
            Company name
          </label>
          <input
            id="company_name"
            name="company_name"
            type="text"
            defaultValue={settings?.company_name}
            className={field}
          />
        </div>

        <div>
          <label htmlFor="tin" className="micro mb-2 block">
            TIN
          </label>
          <input id="tin" name="tin" type="text" defaultValue={settings?.tin ?? ""} className={`numeric ${field}`} />
        </div>

        <div>
          <label htmlFor="phone" className="micro mb-2 block">
            Phone
          </label>
          <input id="phone" name="phone" type="tel" defaultValue={settings?.phone ?? ""} className={`numeric ${field}`} />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="address" className="micro mb-2 block">
            Address
          </label>
          <input id="address" name="address" type="text" defaultValue={settings?.address ?? ""} className={field} />
        </div>

        <div>
          <label htmlFor="expiry_alert_days" className="micro mb-2 block">
            Warn about expiry
          </label>
          <div className="flex items-center gap-2">
            <input
              id="expiry_alert_days"
              name="expiry_alert_days"
              type="number"
              min="0"
              max="365"
              defaultValue={settings?.expiry_alert_days ?? 30}
              className={`numeric ${field}`}
            />
            <span className="shrink-0 text-sm text-ink-3">days ahead</span>
          </div>
        </div>
      </div>

      <FormError message={state.error} />
      {state.notice ? (
        <p role="status" className="mt-4 border-2 border-tally bg-tally-soft px-3 py-2 text-sm text-tally">
          {state.notice}
        </p>
      ) : null}

      <div className="mt-5">
        <Submit />
      </div>
    </form>
  );
}
