// shadcn Sonner, source copy, de-defaulted: bottom-right, mono, no
// richColors (the library's colored-by-severity toasts fight the two-color
// semantics), neutral surface plus the accent border for the rare
// attention-worthy toast.
import { Toaster as Sonner } from "sonner";
import type { ToasterProps } from "sonner";

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-right"
      duration={2500}
      richColors={false}
      toastOptions={{
        classNames: {
          toast:
            "font-mono! text-[13px]! bg-surface-panel! text-text-default! border! border-border-panel! rounded-md! shadow-none!",
          description: "text-text-caption!",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
