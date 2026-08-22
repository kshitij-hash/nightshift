// shadcn Badge, source copy, de-defaulted: outline is the default everywhere
// state tags appear; the filled accent variant is reserved for VERIFIED
// states only (the accent's one flex point outside the live/action role).
// 10px caps, tracking-wide, per the spec's state-tag typography.
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-sm border px-1.5 py-0.5 text-[10px] font-medium font-mono uppercase tracking-[0.14em] leading-none w-fit whitespace-nowrap shrink-0 gap-1 [&_svg]:size-2.5 [&_svg]:pointer-events-none",
  {
    variants: {
      variant: {
        outline: "border-border-field text-text-label bg-transparent",
        verified: "border-transparent bg-primary text-primary-foreground",
      },
    },
    defaultVariants: {
      variant: "outline",
    },
  },
);

export type BadgeProps = React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    asChild?: boolean;
  };

function Badge({ className, variant, asChild = false, ...props }: BadgeProps) {
  const Comp = asChild ? Slot : "span";
  return (
    <Comp data-slot="badge" className={cn(badgeVariants({ variant, className }))} {...props} />
  );
}

export { Badge, badgeVariants };
