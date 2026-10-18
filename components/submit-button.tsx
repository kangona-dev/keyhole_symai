"use client";

import { useFormStatus } from "react-dom";

/** A submit button that disables itself while its form is sending, so a double-click submits once. */
export default function SubmitButton({
  children,
  pendingText,
  className,
}: {
  children: React.ReactNode;
  pendingText: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-disabled={pending} className={`${className ?? ""} disabled:opacity-50`}>
      {pending ? pendingText : children}
    </button>
  );
}
