// The masked avatar: every subscriber and every creator is drawn with the bar
// over the eyes. The bar is the logo; nothing on the product shows a face.

export type AvatarTone = "rose" | "plain" | "filled";

export function MaskedAvatar({
  size = 40,
  tone = "rose",
  className,
}: {
  size?: number;
  tone?: AvatarTone;
  className?: string;
}) {
  if (tone === "filled") {
    return (
      <svg width={size} height={size} viewBox="0 0 88 88" fill="none" aria-hidden="true" className={className}>
        <circle cx="44" cy="44" r="42" fill="var(--ad-rose)" />
        <circle cx="44" cy="36" r="14" fill="var(--ad-on-rose)" />
        <path d="M18 74c4-16 14-24 26-24s22 8 26 24" fill="var(--ad-on-rose)" />
        <rect x="24" y="30" width="40" height="11" fill="var(--ad-ink)" />
      </svg>
    );
  }
  const stroke = tone === "rose" ? "var(--ad-rose)" : "var(--ad-line-strong)";
  const bar = tone === "rose" ? "var(--ad-rose)" : "var(--ad-ink)";
  return (
    <svg width={size} height={size} viewBox="0 0 88 88" fill="none" aria-hidden="true" className={className}>
      <circle cx="44" cy="44" r="42" fill="var(--ad-silhouette)" stroke={stroke} strokeWidth="3" />
      <circle cx="44" cy="36" r="14" fill="var(--ad-silhouette-2)" />
      <path d="M18 74c4-16 14-24 26-24s22 8 26 24" fill="var(--ad-silhouette-2)" />
      <rect x="24" y="30" width="40" height="11" fill={bar} />
    </svg>
  );
}

/** A padlock in the same circle, for a room that is closed to the reader. */
export function LockedAvatar({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 88 88" fill="none" aria-hidden="true" className={className}>
      <circle cx="44" cy="44" r="42" fill="var(--ad-silhouette)" stroke="var(--ad-line-strong)" strokeWidth="3" />
      <rect x="26" y="34" width="36" height="28" rx="3" fill="var(--ad-silhouette-2)" />
      <rect x="34" y="20" width="20" height="18" rx="10" fill="none" stroke="var(--ad-silhouette-2)" strokeWidth="4" />
      <rect x="24" y="42" width="40" height="11" fill="var(--ad-ink)" />
    </svg>
  );
}
