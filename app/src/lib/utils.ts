import { clsx } from "clsx";
import type { ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Standard shadcn class combinator: clsx for conditionals, tailwind-merge
 *  to resolve conflicting utility classes deterministically. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
