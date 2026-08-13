"use client";

import { Plus, X } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { LocationRow, TeamMemberRow } from "@/lib/data/types";
import type { Role } from "@/lib/permissions";
import { canManageMember, grantableRoles, hasFullAccess } from "@/lib/permissions";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { addTeamMember, updateTeamMember, type ActionState } from "./actions";

const field =
  "w-full border-2 border-line bg-panel-2 px-3 py-2.5 text-ink outline-none focus-visible:border-focus";

const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  warehouse_staff: "Warehouse",
  retail_staff: "Shop",
};

const ROLE_NOTE: Record<Role, string> = {
  owner: "Everything, including who else is an owner.",
  admin: "Everything an owner can do, except touching an owner's account.",
  warehouse_staff: "Warehouse floor. Never sees cost, margin, or stock value.",
  retail_staff: "Shop floor. Never sees cost, margin, or stock value.",
};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Adding…" : "Add to team"}
    </Button>
  );
}

/**
 * The controls on one member's row.
 *
 * Own component so each row carries its own action state -- a refused change
 * has to appear next to the person it was refused for, not at the top of a
 * list of five.
 */
function MemberControls({ member, viewerRole }: { member: TeamMemberRow; viewerRole: Role }) {
  const [state, formAction] = useActionState<ActionState, FormData>(updateTeamMember, {
    error: null,
  });
  const grantable = grantableRoles(viewerRole);
  const suspended = member.status !== "active";

  return (
    <div className="shrink-0 text-right">
      <div className="flex items-center justify-end gap-2">
        <form action={formAction}>
          <input type="hidden" name="user_id" value={member.id} />
          <label htmlFor={`role-${member.id}`} className="sr-only">
            Role for {member.full_name}
          </label>
          <select
            id={`role-${member.id}`}
            name="role"
            defaultValue={member.role}
            // Submitting on change keeps the row to one control instead of a
            // select plus a save button repeated down the list.
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
            className="border-2 border-line bg-panel-2 px-2 py-1.5 text-sm text-ink outline-none focus-visible:border-focus"
          >
            {/* The member's current role is always listed, even when the viewer
                could not grant it, so the select never misreports who they are. */}
            {(grantable.includes(member.role) ? grantable : [member.role, ...grantable]).map(
              (role) => (
                <option key={role} value={role} disabled={!grantable.includes(role)}>
                  {ROLE_LABEL[role]}
                </option>
              ),
            )}
          </select>
        </form>

        <form action={formAction}>
          <input type="hidden" name="user_id" value={member.id} />
          <input type="hidden" name="status" value={suspended ? "active" : "suspended"} />
          <Button type="submit" variant="secondary" size="sm">
            {suspended ? "Restore" : "Suspend"}
          </Button>
        </form>
      </div>

      {state.error ? (
        <p role="alert" className="mt-1.5 max-w-56 text-xs text-signal">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}

export function TeamPanel({
  team,
  locations,
  viewerId,
  viewerRole,
}: {
  team: TeamMemberRow[];
  locations: LocationRow[];
  viewerId: string;
  viewerRole: Role;
}) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<Role>("warehouse_staff");
  const [state, formAction] = useActionState<ActionState, FormData>(
    async (prev, formData) => {
      const result = await addTeamMember(prev, formData);
      if (result.ok) setOpen(false);
      return result;
    },
    { error: null },
  );

  const grantable = grantableRoles(viewerRole);

  return (
    <div className="rule bg-panel">
      <div className="flex items-center justify-between gap-3 border-b-2 border-line px-4 py-3">
        <div>
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-ink">Team</h2>
          <p className="mt-0.5 text-sm text-ink-3">
            Staff record movements. They never see cost, margin, or stock value. Admins see
            everything an owner does.
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

            {canManageMember(viewerRole, member.role, member.id === viewerId) ? (
              <MemberControls member={member} viewerRole={viewerRole} />
            ) : (
              // An owner's row seen by an admin, or your own row. Neither is
              // editable here, and the database refuses it either way.
              <span className="code shrink-0">
                {member.id === viewerId ? "you" : "full access"}
              </span>
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
              <select
                id="role"
                name="role"
                required
                value={role}
                onChange={(event) => setRole(event.target.value as Role)}
                className={field}
              >
                {grantable.map((option) => (
                  <option key={option} value={option}>
                    {ROLE_LABEL[option]}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-ink-3">{ROLE_NOTE[role]}</p>
            </div>
          </div>

          {/* Owners and admins answer for the whole company; the database gives
              them every location, so asking would be a question with one answer. */}
          {hasFullAccess(role) ? null : (
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
          )}

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
