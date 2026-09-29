// shadcn/ui Alert, copied on 2026-09-29 from https://ui.shadcn.com/r/styles/new-york-v4/alert.json, with the success
// and warning variants added, and the destructive one tinted like them where the registry draws it on bg-card. The
// registry imports `cn` from the `cn` package; here it comes from @/lib/utils, which the project already has.
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current",
  {
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        // Tinted like the status variants below, so an error reads as one at a glance (the registry uses bg-card).
        destructive:
          "border-destructive/30 bg-destructive/10 text-destructive *:data-[slot=alert-description]:text-destructive/90 [&>svg]:text-current",
        // Not in the registry: tinted status surfaces, read from the success and warning tokens.
        success:
          "border-success/30 bg-success/10 text-success-foreground *:data-[slot=alert-description]:text-success-foreground/90",
        warning:
          "border-warning/30 bg-warning/10 text-warning-foreground *:data-[slot=alert-description]:text-warning-foreground/90",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Alert({ className, variant, ...props }: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return <div data-slot="alert" role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn("col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight", className)}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-muted-foreground col-start-2 grid justify-items-start gap-1 text-sm [&_p]:leading-relaxed",
        className,
      )}
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription };
