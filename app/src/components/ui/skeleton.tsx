// shadcn Skeleton, source copy, de-defaulted twice over.
//
// The stock component is `animate-pulse bg-accent`: a shimmer on a colour from
// the theme's accent slot. Both are wrong here. A page that has not read the
// chain yet has nothing to report, and a pulsing fill reports activity that is
// not happening; the accent means live, attention, action in this product, and
// a placeholder is none of the three.
//
// The fill is --surface-fill rather than white at 6%, which is what this was.
// White at 6% is a dark-theme idiom: on the light theme's white panels it is
// invisible, so every skeleton in that theme was a row of bars that were not
// there. --surface-fill is defined in both themes at the same step of the same
// scale, and both callers were already overriding to it by hand.
//
// Callers size it. A skeleton mirrors the final layout exactly, or it is a
// second layout that will eventually disagree with the first one.
import type { ComponentProps } from "react";

import { cn } from "../../lib/utils";

function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("rounded-none bg-surface-fill", className)}
      {...props}
    />
  );
}

export { Skeleton };
