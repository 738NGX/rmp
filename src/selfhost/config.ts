/**
 * Self-hosted mode is intentionally opt-in so upstream builds retain their
 * original account and subscription behaviour.
 */
export const isSelfHosted = import.meta.env.VITE_RMP_SELFHOST === 'true';

/** Self-hosted installations own their entitlement instead of using RMT. */
export const selfHostedSubscriptions = {
    RMP_CLOUD: true,
    RMP_EXPORT: true,
};

export const SELFHOST_API_PATH = '/api/rmp-saves';
