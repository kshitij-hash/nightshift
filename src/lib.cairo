// NIGHTSHIFT — recurring private authorization on the STRK20 pool.
//
// Layout (built up over the sprint):
//   common — tags, Schedule/Tier types, pack/unpack, message-hash builders
//   vault  — the anonymizer contract the pool invokes (subscribe / release / cancel)
//   gate   — standalone tier gate over a deployed vault: enroll / present
//            plus the is_active / tier_of read surface

pub mod common;
pub mod gate;
pub mod mocks;
pub mod vault;
