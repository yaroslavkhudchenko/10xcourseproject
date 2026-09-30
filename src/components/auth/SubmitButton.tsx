import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

interface SubmitButtonProps {
  pendingText: string;
  icon: ReactNode;
  children: ReactNode;
}

export function SubmitButton({ pendingText, icon, children }: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    // The sign-in pages keep the starter's purple button until S-07 restyles them: without the default Button's border,
    // hard shadow and shift while pressed.
    <Button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg border-0 bg-purple-600 px-4 py-2 font-medium text-white shadow-none transition-colors hover:bg-purple-500 active:translate-none"
    >
      {pending ? (
        <span className="flex items-center gap-2">
          <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          {pendingText}
        </span>
      ) : (
        <span className="flex items-center gap-2">
          {icon}
          {children}
        </span>
      )}
    </Button>
  );
}
