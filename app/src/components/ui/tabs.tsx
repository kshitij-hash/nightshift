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
        // Focus is the document rule in base.css: a solid 2px accent outline,
        // held off the glyphs by --focus-offset. The ring it replaces was a
        // box-shadow at 55% alpha drawn hard against the text, and between the
        // dull maroon that composited to and the square corners flush on the
        // label, it read as an error box around the tab. rounded-sm gives the
        // outline the system's 2px corner instead of a hard 90 degrees.
        // outline-offset 4 rather than the document's 2: a tab's selected-state
        // underline sits exactly where a 2px ring would land, and the two
        // accent lines merging read as one thick bar rather than as a ring.
        "rounded-sm focus-visible:outline-offset-4",
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
        // The panel is focusable, so it keeps the document's focus outline
        // rather than opting out of it.
        "flex-1 rounded-sm",
        "data-[state=inactive]:opacity-0 data-[state=active]:opacity-100 transition-opacity duration-[var(--dur-fast)] ease-[var(--ease-in-out)]",
        className,
      )}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
