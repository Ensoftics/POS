import { config } from 'zod';

// The production Content-Security-Policy forbids eval. Zod would otherwise probe for it
// (new Function) and every page load would report a CSP violation; validation is
// unchanged without its compiled fast path.
config({ jitless: true });
