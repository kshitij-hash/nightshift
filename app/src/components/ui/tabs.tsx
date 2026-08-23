// shadcn Tabs, source copy, de-defaulted: the line (underline) variant only.
// The stock shadcn TabsList is a pill/boxed segmented control; that styling
// is stripped entirely rather than offered as an alternate variant, per the
// spec's "variant='line', never the pill TabsList".
import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "../../lib/utils";

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  );
}

function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex h-9 items-center gap-4 border-b border-border-hairline",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-9 items-center justify-center px-1 text-[13px] font-medium font-mono text-text-label",
        "border-b-2 border-transparent -mb-px transition-colors duration-[var(--dur-fast)]",
        "hover:text-text-default",
        "data-[state=active]:text-text-strong data-[state=active]:border-primary",
        "disabled:pointer-events-none disabled:opacity-50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(
        // The panel is focusable, so it keeps a visible indicator of its own
        // rather than relying on the document default it opts out of.
        "flex-1 outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "data-[state=inactive]:opacity-0 data-[state=active]:opacity-100 transition-opacity duration-[var(--dur-fast)] ease-[var(--ease-in-out)]",
        className,
      )}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
