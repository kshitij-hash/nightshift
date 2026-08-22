// shadcn Skeleton, source copy, de-defaulted: bg-white/6, no shimmer sweep.
// A skeleton should mirror the final layout exactly - this component only
// supplies the fill color; callers size it to match the real content.
import type { ComponentProps } from "react";

import { cn } from "../../lib/utils";

function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-white/6", className)}
      {...props}
    />
  );
}

export { Skeleton };
