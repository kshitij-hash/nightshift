// Shared types for the vault and the gate. Fleshed out as the contracts land.

/// Billing period, in seconds. Quantized: only ladder values are accepted at
/// subscribe time, so amounts and periods cannot fingerprint a subscriber.
pub const PERIOD_WEEK: u64 = 604800;
pub const PERIOD_MONTH: u64 = 2592000;
