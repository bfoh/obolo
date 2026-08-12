"use client";

import { Plus, X } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { LocationRow, TeamMemberRow } from "@/lib/data/types";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { addTeamMember, updateTeamMember, type ActionState } from "./actions";

const field =
  "w-full border-2 border-line bg-panel-2 px-3 py-2.5 text-ink outline-none focus-visible:border-focus";

const ROLE_LABEL: Record<TeamMemberRow["role"], string> = {
  owner: "Owner",
  warehouse_staff: "Warehouse",
  retail_staff: "Shop",
};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Adding…" : "Add to team"}
    </Button>
  );
}

export function TeamPanel({
  team,
  locations,
}: {
  team: TeamMemberRow[];
  locations: LocationRow[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await addTeamMember(prev, formData);
      if (result.ok) setOpen(false);
      return result;
    },
    { error: null },
  );

  return (
    <div className="rule bg-panel">
      <div className="flex items-center justify-between gap-3 border-b-2 border-line px-4 py-3">
        <div>
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">Team</h2>
          <p className="mt-0.5 text-sm text-ink-3">
            Staff record movements. They never see cost, margin, or stock value.
          </p>
        </div>
        {!open ? (
          <Button type="button" size="sm" onClick={() => setOpen(true)}>
            <Plus size={14} aria-hidden />
            Add
          </Button>
        ) : null}
      </div>

      <ul className="divide-y divide-hairline">
        {team.map((member) => (
          <li key={member.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 truncate text-sm text-ink">
                {member.full_name}
                <StatusBadge tone={member.status === "active" ? "done" : "dead"}>
                  {ROLE_LABEL[member.role]}
                </StatusBadge>
              </p>
              <p className="code truncate">
                {member.email}
                {member.status === "active" ? "" : " · suspended"}
              </p>
            </div>

            {member.role === "owner" ? (
              <span className="code shrink-0">full access</span>
            ) : (
              <form action={updateTeamMember} className="shrink-0">
                <input type="hidden" name="user_id" value={member.id} />
                <input
                  type="hidden"
                  name="status"
                  value={member.status === "active" ? "suspended" : "active"}
                />
                <Button type="submit" variant="secondary" size="sm">
                  {member.status === "active" ? "Suspend" : "Restore"}
                </Button>
              </form>
            )}
          </li>
        ))}
      </ul>

      {open ? (
        <form action={formAction} className="border-t-2 border-line p-4">
          <div className="mb-4 flex items-start justify-between gap-3">
            <h3 className="font-display text-sm font-bold uppercase tracking-wide text-ink">
              Add someone
            </h3>
            <Button type="button" variant="quiet" size="sm" onClick={() => setOpen(false)} aria-label="Close">
              <X size={16} aria-hidden />
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="full_name" className="micro mb-2 block">
                Name
              </label>
              <input id="full_name" name="full_name" type="text" required className={field} />
            </div>
            <div>
              <label htmlFor="member_email" className="micro mb-2 block">
                Email
              </label>
              <input id="member_email" name="email" type="email" required className={field} />
            </div>
            <div>
              <label htmlFor="password" className="micro mb-2 block">
                Starting password
              </label>
              <input
                id="password"
                name="password"
                type="text"
                required
                minLength={8}
                className={field}
              />
              <p className="mt-1.5 text-xs text-ink-3">
                Give this to them directly. They can change it after signing in.
              </p>
            </div>
            <div>
              <label htmlFor="role" className="micro mb-2 block">
                Role
              </label>
              <select id="role" name="role" required defaultValue="warehouse_staff" className={field}>
                <option value="warehouse_staff">Warehouse</option>
                <option value="retail_staff">Shop</option>
              </select>
            </div>
          </div>

          <fieldset className="mt-4">
            <legend className="micro mb-2">Works at</legend>
            <div className="flex flex-wrap gap-4">
              {locations.map((location) => (
                <label key={location.id} className="flex items-center gap-2.5 text-sm text-ink">
                  <input
                    type="checkbox"
                    name="location_ids"
                    value={location.id}
                    className="h-4 w-4 border-2 border-line accent-[var(--ink)]"
                  />
                  {location.name}
                </label>
              ))}
            </div>
          </fieldset>

          <FormError message={state.error} />

          <div className="mt-5">
            <Submit />
          </div>
        </form>
      ) : null}

      {state.notice && !open ? (
        <p role="status" className="border-t-2 border-line px-4 py-3 text-sm text-tally">
          {state.notice}
        </p>
      ) : null}
    </div>
  );
}
