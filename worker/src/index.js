// Cloudflare Worker entry. The logic is in handler.js; this only wires the D1 binding and the CORS allow-list.
import { handle } from './handler.js';
import { createD1Store } from './d1-store.js';

// The live site, plus localhost for development. Anything else gets no CORS headers and a 403 when it sends Origin.
const ORIGIN_OK = (o) => o === 'https://op-h.github.io' || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);

export default {
  fetch: (request, env) => handle(request, createD1Store(env.DB), { origins: ORIGIN_OK }),
};
