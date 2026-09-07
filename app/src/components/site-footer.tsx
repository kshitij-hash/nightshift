// The detail pages' footer. Same footer as everywhere else; the per-page link
// rows and the vault line those pages used to print are gone, because the
// Receipts page is where that story is told now.

import { AppFooter } from "./shell/footer";

type FooterRoute = "/board" | "/verify";

export type FooterLink =
  | { label: string; href: string }
  | { label: string; to: FooterRoute };

export function SiteFooter(_props: {
  links?: FooterLink[];
  ids?: string[];
  snapshot?: boolean;
  voyagerLabel?: string;
  className?: string;
}) {
  return <AppFooter />;
}
