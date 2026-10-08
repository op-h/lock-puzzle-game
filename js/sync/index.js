// Production wiring: the only sync module that reads config.js. Everything else takes its
// dependencies as arguments, which is what lets the tests run against a fake backend.

import { CLOUD } from '../config.js';
import { createLocal } from './local.js';
import { createSync } from './sync.js';

export { formatCode, parseCode, validateName, NAME_MAX, boardId } from './identity.js';
export { derive } from './merge.js';

const OFFLINE = Object.freeze({ ok: false, reason: 'offline' });

/**
 * remote.js stays out of the first-load graph: it is fetched on the first real network call. A failed
 * fetch of the module itself (offline, uncached) is reported like any other offline result.
 */
function createLazyRemote(fetchImpl) {
  let loading = null;
  const load = () => {
    loading ??= import('./remote.js')
      .then((m) => m.createRemote({ projectId: CLOUD.projectId, apiKey: CLOUD.apiKey, enabled: CLOUD.enabled, fetch: fetchImpl }))
      .catch(() => {
        loading = null; // try again next time rather than staying broken for the whole session
        return null;
      });
    return loading;
  };
  const call = (name) => async (...args) => {
    const r = await load();
    return r ? r[name](...args) : OFFLINE;
  };
  return {
    enabled: CLOUD.enabled,
    getPlayer: call('getPlayer'),
    createPlayer: call('createPlayer'),
    updatePlayer: call('updatePlayer'),
    putBoard: call('putBoard'),
    listBoard: call('listBoard'),
  };
}

export function createAppSync(opts = {}) {
  const remote = createLazyRemote(opts.fetch);
  const local = createLocal(opts.storage === undefined ? {} : { storage: opts.storage });
  const sync = createSync({ remote: /** @type {any} */ (remote), local, events: opts.events || null });
  return { sync, local, remote };
}
