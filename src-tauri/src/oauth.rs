use std::sync::atomic::{AtomicU64, Ordering};

static OAUTH_GENERATION: AtomicU64 = AtomicU64::new(1);

pub fn begin_attempt() -> u64 {
    OAUTH_GENERATION.fetch_add(1, Ordering::SeqCst) + 1
}

pub fn cancel_attempt() {
    OAUTH_GENERATION.fetch_add(1, Ordering::SeqCst);
}

pub fn is_current(generation: u64) -> bool {
    OAUTH_GENERATION.load(Ordering::SeqCst) == generation
}
