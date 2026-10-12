// In the app merge.js is fetched lazily (js/sync/lazy-merge.js); unit tests that drive sync.js / local.js directly
// import this file once so it is already loaded, exactly as it is after sign-up, sign-in or resume.
import { loadMerge } from '../../../js/sync/lazy-merge.js';

await loadMerge();
