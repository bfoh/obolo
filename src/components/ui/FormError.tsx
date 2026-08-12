/**
 * Failure message for a form.
 *
 * Errors explain what happened and what to do, in the interface's voice. They
 * do not apologise and they are never vague -- "insufficient stock: short by 12
 * of 150 units" is more use than "something went wrong".
 */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;

  return (
    <p
      role="alert"
      aria-live="polite"
      className="mt-4 border-2 border-signal bg-signal-soft px-3 py-2 text-sm text-signal"
    >
      {message}
    </p>
  );
}
