// The motion tokens, mirrored for the two places that cannot read CSS custom
// properties: NumberFlow's timing options and the replay driver's clock.
// These are the same values as src/styles/tokens/motion.css. No third easing
// exists in this product, and nothing here may introduce one.

export const EASE_OUT = "cubic-bezier(0.25, 1, 0.5, 1)";
export const EASE_IN_OUT = "cubic-bezier(0.65, 0, 0.35, 1)";

export const DUR_QUICK = 150;
export const DUR_BASE = 180;
export const DUR_SLOW = 480;
export const FLASH_ROW = 900;
export const FLASH_NUMBER = 400;

/** Per-digit roll for every number that changes on this page. */
export const NUMBER_TIMING = { duration: DUR_SLOW, easing: EASE_OUT } as const;
export const NUMBER_OPACITY_TIMING = { duration: DUR_BASE, easing: EASE_OUT } as const;
