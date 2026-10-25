// channels.js — Named pub/sub channels. No global store, no wildcards.
// Zero dependencies.

const channels = new Map(); // topic -> Set<callback>

/**
 * Call `callback(data)` for every publish on `topic`. Returns an unsubscribe
 * function; alternatively pass { signal } and abort it (e.g. a component's
 * this.signal) to unsubscribe. Subscribing the same function twice to one
 * topic registers it once, as with addEventListener.
 */
export function subscribe(topic, callback, { signal } = {}) {
  const off = () => unsubscribe(topic, callback);
  if (signal?.aborted) return off;
  let subs = channels.get(topic);
  if (!subs) {
    subs = new Set();
    channels.set(topic, subs);
  }
  subs.add(callback);
  signal?.addEventListener('abort', off, { once: true });
  return off;
}

export function unsubscribe(topic, callback) {
  const subs = channels.get(topic);
  if (subs) {
    subs.delete(callback);
    if (subs.size === 0) channels.delete(topic);
  }
}

// Same semantics as EventTarget dispatch: handlers added during a publish are
// not called by it; handlers removed during it are not called after removal.
export function publish(topic, data) {
  const subs = channels.get(topic);
  if (!subs) return;
  for (const cb of [...subs]) {
    if (!channels.get(topic)?.has(cb)) continue;
    try { cb(data); } catch (e) { console.error(`channel "${topic}" handler error:`, e); }
  }
}

/** Remove every subscription (mainly for tests). */
export function reset() {
  channels.clear();
}
