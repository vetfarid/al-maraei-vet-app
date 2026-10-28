const U = () => { try { return JSON.parse(sessionStorage.getItem('fakeuser') || 'null'); } catch (e) { return null; } };
const call = (op, a) => window.__fakeCall(op, { ...a, user: U() });
const wrap = v => { if (Array.isArray(v)) return v.map(wrap); if (v && typeof v === 'object') { if (v.__t !== undefined) return { toMillis: () => v.__t, toDate: () => new Date(v.__t) }; const o = {}; for (const k in v) o[k] = wrap(v[k]); return o; } return v; };
export const getFirestore = () => ({});
export const collection = (fs, c) => ({ kind: 'coll', coll: c });
export const doc = (fs, c, id) => ({ kind: 'doc', path: c + '/' + id, coll: c, id });
export const where = (f, o, v) => ({ t: 'w', a: [f, o, v] });
export const orderBy = (f, d = 'asc') => ({ t: 'o', a: [f, d] });
export const query = (c, ...cs) => ({ kind: 'q', coll: c.coll, wheres: cs.filter(x => x.t === 'w').map(x => x.a), order: (cs.find(x => x.t === 'o') || {}).a });
export const serverTimestamp = () => ({ __sv: 'ts' });
const snapDoc = (r, res) => ({ id: r.id, exists: () => res.exists, data: () => (res.data ? wrap(res.data) : undefined), metadata: { hasPendingWrites: false } });
export const getDoc = async r => snapDoc(r, await call('get', { path: r.path }));
export const setDoc = async (r, data, opts) => { const w = { type: 'set', path: r.path, data }; if (opts && opts.merge) { const cur = await call('get', { path: r.path }); w.data = { ...(cur.data || {}), ...data }; } await call('commit', { writes: [w] }); };
export const updateDoc = async (r, data) => { await call('commit', { writes: [{ type: 'update', path: r.path, data }] }); };
export const deleteDoc = async r => { await call('commit', { writes: [{ type: 'delete', path: r.path }] }); };
export const runTransaction = async (fs, fn) => {
  for (let i = 0; i < 5; i++) {
    const reads = {}, writes = [];
    const tx = { get: async r => { const res = await call('get', { path: r.path }); reads[r.path] = res.v; return snapDoc(r, res); }, set: (r, d) => writes.push({ type: 'set', path: r.path, data: d }), update: (r, d) => writes.push({ type: 'update', path: r.path, data: d }), delete: r => writes.push({ type: 'delete', path: r.path }) };
    const out = await fn(tx);
    try { await call('commit', { reads, writes }); return out; } catch (e) { if (e.code !== 'aborted') throw e; }
  }
  throw Object.assign(new Error('aborted'), { code: 'aborted' });
};
export const onSnapshot = (ref, cb, err) => {
  let stop = false, prev = null;
  const tick = async () => {
    if (stop) return;
    try {
      if (ref.kind === 'doc') { const res = await call('get', { path: ref.path }), s = JSON.stringify(res); if (s !== prev) { prev = s; cb(snapDoc(ref, res)); } }
      else {
        const rows = await call('list', { coll: ref.coll, wheres: ref.wheres, order: ref.order }), s = JSON.stringify(rows);
        if (s !== prev) { const old = new Map((prev ? JSON.parse(prev) : []).map(x => [x.id, JSON.stringify(x.data)])), ch = [];
          rows.forEach(x => { const o = old.get(x.id); if (o === undefined) ch.push({ type: 'added', doc: { id: x.id, data: () => wrap(x.data) } }); else if (o !== JSON.stringify(x.data)) ch.push({ type: 'modified', doc: { id: x.id, data: () => wrap(x.data) } }); });
          old.forEach((v, id) => { if (!rows.find(x => x.id === id)) ch.push({ type: 'removed', doc: { id, data: () => ({}) } }); });
          prev = s; cb({ size: rows.length, docs: rows.map(x => ({ id: x.id, data: () => wrap(x.data) })), docChanges: () => ch, metadata: { hasPendingWrites: false } }); }
      }
    } catch (e) { if (e.code !== 'unavailable') { if (err) err(e); stop = true; return; } }
    setTimeout(tick, 120);
  };
  tick(); return () => { stop = true; };
};
