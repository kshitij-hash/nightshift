// Focus is the one document rule in base.css rather than a per-component
// ring. The ring here used to be a box-shadow drawn flush against the button
// edge, which on the filled primary put an accent tint on an accent fill and
// on the outline variants read as a second border. The document outline sits
// --focus-offset outside the button, on the page ground, where it is legible
// against every variant this button has.
//
// shadcn Button, source copy, de-defaulted per the design spec: 4px radius
// family, and the variant set trimmed to what the spec actually allows on a
// screen - "default" is the one filled primary a screen may use at a time;
// everything else is outline or ghost. "destructive" exists only for the
// two sanctioned irreversible actions (cancel subscription, reclaim) and is
// never decorative.
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-[13px] font-medium leading-none font-mono transition-[background-color,color,border-color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)] disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] active:duration-[var(--dur-instant)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:size-3.5",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground border border-primary hover:bg-[var(--accent-hover)] hover:border-[var(--accent-hover)]",
        outline:
          "border border-border-field bg-transparent text-foreground hover:bg-secondary",
        ghost: "bg-transparent text-foreground hover:bg-secondary border border-transparent",
        destructive:
          "bg-transparent text-destructive border border-destructive hover:bg-destructive hover:text-destructive-foreground",
      },
      size: {
        sm: "h-6 px-2 text-[12px] gap-1.5",
        md: "h-8 px-3",
        lg: "h-10 px-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
