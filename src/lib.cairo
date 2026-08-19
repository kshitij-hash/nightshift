// NIGHTSHIFT — recurring private authorization on the STRK20 pool.
//
// Layout (built up over the sprint):
//   common — tags, Schedule/Tier types, pack/unpack, message-hash builders
//   vault  — the anonymizer contract the pool invokes (subscribe / release / cancel)
//   gate   — public read surface: is_active / tier_of / present

pub mod common;
