// محرك المزامنة (بدون DOM وبدون Firebase) — يعمل في المتصفح وفي Node للاختبارات.
// الفكرة: التطبيق يحتفظ بنفس كائن db القديم، والمحرك يقارنه بآخر نسخة متزامنة (base)
// ويرسل الفروق فقط كسجلات منفصلة، مع كشف التعارض ودمج ثلاثي (base/local/remote) وقائمة انتظار دائمة.
export const COLLS = ['patients','appointments','finance','requests','chicks','batches','shortages','orders','companies','debts'];
export const ID_RE = /^[A-Za-z0-9_\-:.]{1,80}$/;
export const META_COLL = 'meta', SETTINGS_ID = 'settings';
const IMG_MIN = 4000, MAX_TRIES = 8;
const SYNC_KEYS = ['rev','updatedAt','createdAt','_deleted'];

export function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
export function stable(v) {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
}
export const isImg = v => typeof v === 'string' && v.startsWith('data:image/') && v.length > IMG_MIN;
export const imgMarker = d => '@img:' + cyrb53(d).toString(36) + '-' + d.length.toString(36);
export const isMarker = v => typeof v === 'string' && v.startsWith('@img:');
export const imgIdOf = m => m.slice(5);
const clone = o => JSON.parse(JSON.stringify(o));

// يفصل الصور الكبيرة (data URL) عن السجل ويستبدلها بمؤشر ثابت
export function slim(rec) {
  const s = {}, images = {};
  for (const [k, v] of Object.entries(rec)) { if (isImg(v)) { const m = imgMarker(v); s[k] = m; images[m] = v; } else s[k] = (v !== null && typeof v === 'object') ? clone(v) : v; }
  return { slim: s, images };
}
export function stripMeta(doc) { const o = {}; for (const [k, v] of Object.entries(doc)) if (!SYNC_KEYS.includes(k)) o[k] = v; return o; }
const trunc = v => { const s = typeof v === 'string' ? v : stable(v); return s.length > 400 ? s.slice(0, 400) + '…' : s; };
const ident = e => (e && typeof e === 'object' && e.id != null) ? 'id:' + e.id : 'v:' + stable(e);

function mergeArr(b, l, r, lt, rt, conf, field) {
  const M = a => new Map((a || []).map(e => [ident(e), e]));
  const mb = M(b), ml = M(l), mr = M(r), out = [];
  const order = [...mr.keys(), ...[...ml.keys()].filter(k => !mr.has(k))];
  for (const id of order) {
    const inB = mb.has(id), inL = ml.has(id), inR = mr.has(id);
    const eb = mb.get(id), el = ml.get(id), er = mr.get(id);
    if (inL && inR) {
      if (stable(el) === stable(er)) out.push(el);
      else if (inB && stable(eb) === stable(el)) out.push(er);
      else if (inB && stable(eb) === stable(er)) out.push(el);
      else { const lw = lt >= rt; out.push(lw ? el : er); conf.push({ field: field + '[' + id + ']', lost: lw ? 'remote' : 'local', value: trunc(lw ? er : el) }); }
    } else if (inL) { if (!inB || stable(el) !== stable(eb)) out.push(el); }
    else if (inR) { if (!inB || stable(er) !== stable(eb)) out.push(er); }
  }
  return out;
}
// دمج ثلاثي على مستوى الحقول: من غيّر حقلًا لوحده يكسب، ولو الاتنين غيّروه الأحدث يكسب والخاسر يتسجل (لا فقد صامت)
export function merge3(base, local, remote, lt, rt) {
  const keys = new Set([...Object.keys(base || {}), ...Object.keys(local), ...Object.keys(remote)]);
  const out = {}, conf = [];
  for (const k of keys) {
    const b = stable(base?.[k]), l = stable(local[k]), r = stable(remote[k]);
    let v;
    if (l === r) v = local[k];
    else if (l === b) v = remote[k];
    else if (r === b) v = local[k];
    else if (Array.isArray(local[k]) && Array.isArray(remote[k])) v = mergeArr(base?.[k], local[k], remote[k], lt, rt, conf, k);
    else { const lw = lt >= rt; v = lw ? local[k] : remote[k]; conf.push({ field: k, lost: lw ? 'remote' : 'local', value: trunc(lw ? remote[k] : local[k]) }); }
    if (v !== undefined) out[k] = v;
  }
  return { merged: out, conflicts: conf };
}

export class MemStore { constructor() { this.m = new Map(); } get(k) { return this.m.has(k) ? this.m.get(k) : null; } set(k, v) { this.m.set(k, v); } remove(k) { this.m.delete(k); } }

export const STATE_KEY = 'maraei_sync_v3';

export class SyncEngine {
  // getDb(): كائن db الحي | store: {get,set} | backend: انظر cloud.js | onChange(): حفظ محلي + إعادة رسم بدون وسم تعديل
  constructor({ getDb, store, backend, now = () => Date.now(), uuid, onStatus = () => {}, onChange = () => {}, schedule = (fn, ms) => setTimeout(fn, ms), isOnline = () => true }) {
    Object.assign(this, { getDb, store, backend, now, onStatus, onChange, schedule, isOnline });
    this.uuid = uuid || (() => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : 'id' + Math.random().toString(36).slice(2) + Date.now().toString(36)));
    let st = null; try { st = JSON.parse(store.get(STATE_KEY) || 'null'); } catch (e) {}
    this.st = st && st.base ? st : { base: {}, outbox: {}, conflicts: [], lastSyncAt: 0 };
    this.running = false; this.timer = null; this.paused = false; this.errState = null; this.ready = false; this.remoteReady = new Set();
    this.imgCache = new Map();
  }
  save() { this.store.set(STATE_KEY, JSON.stringify(this.st)); }
  pending() { return Object.keys(this.st.outbox).length; }
  status() {
    const p = this.pending();
    if (!this.ready) return { state: 'offline', pending: p, text: 'غير متصل بالسحابة' };
    if (this.errState) return { state: 'error', pending: p, error: this.errState, text: 'تعذر الحفظ' };
    if (this.running) return { state: 'syncing', pending: p, text: 'جارٍ الحفظ' };
    if (!this.isOnline()) return { state: 'offline', pending: p, text: p ? 'لا يوجد اتصال — توجد تعديلات معلقة' : 'لا يوجد اتصال' };
    if (p) return { state: 'pending', pending: p, text: 'توجد تعديلات معلقة' };
    return { state: 'synced', pending: 0, at: this.st.lastSyncAt, text: 'تمت المزامنة' };
  }
  emit() { try { this.onStatus(this.status()); } catch (e) {} }
  logConflicts(key, list, src) { for (const c of list) this.st.conflicts.push({ at: this.now(), key, src, ...c }); if (this.st.conflicts.length > 200) this.st.conflicts = this.st.conflicts.slice(-200); }

  // ----- تمثيل السجلات المحلية -----
  localRecords() {
    const db = this.getDb(), out = new Map();
    for (const c of COLLS) for (const r of (db[c] || [])) if (r && typeof r === 'object' && ID_RE.test(String(r.id))) out.set(c + '/' + r.id, r);
    out.set(META_COLL + '/' + SETTINGS_ID, { id: SETTINGS_ID, ...(db.settings || {}) });
    return out;
  }
  ensureIds() { const db = this.getDb(); let ch = false; for (const c of COLLS) for (const r of (db[c] || [])) if (r && typeof r === 'object' && (r.id == null || r.id === '' || !ID_RE.test(String(r.id)))) { r.id = this.uuid(); ch = true; } return ch; }
  // يقارن db الحالي بآخر نسخة متزامنة ويملأ قائمة الانتظار
  scan() {
    const created = this.ensureIds(); const L = this.localRecords(); let changed = created;
    for (const [key, rec] of L) {
      const { slim: s } = slim(rec); const b = this.st.base[key];
      if (key === META_COLL + '/' + SETTINGS_ID && !b && Object.keys(s).length <= 1) continue; // إعدادات فارغة وغير موجودة
      if (b && !b.tomb && stable(b.rec) === stable(s)) { if (this.st.outbox[key]) { delete this.st.outbox[key]; changed = true; } continue; }
      if (b && b.tomb && !L.has(key)) continue;
      const ob = this.st.outbox[key];
      if (!ob || ob.op !== 'set') { this.st.outbox[key] = { op: 'set', ts: this.now(), tries: 0, unknownBase: !b }; changed = true; }
    }
    for (const [key, b] of Object.entries(this.st.base)) {
      if (b.tomb || L.has(key) || key.startsWith(META_COLL + '/')) continue;
      const ob = this.st.outbox[key];
      if (!ob || ob.op !== 'del') { this.st.outbox[key] = { op: 'del', ts: this.now(), tries: 0 }; changed = true; }
    }
    if (changed) this.save();
    return changed;
  }
  localChanged() { this.scan(); this.emit(); this.kick(600); }
  kick(ms = 0) { if (this.timer) clearTimeout(this.timer); this.timer = this.schedule(() => { this.timer = null; this.flush(); }, ms); }

  // ----- تطبيق سجل بعيد على db المحلي -----
  async resolveImages(slimRec) {
    const out = {};
    for (const [k, v] of Object.entries(slimRec)) {
      if (isMarker(v)) {
        const id = imgIdOf(v); let d = this.imgCache.get(id);
        if (!d) { d = await this.backend.getImage(id); if (!d) throw Object.assign(new Error('image-missing'), { code: 'image-missing' }); this.imgCache.set(id, d); }
        out[k] = d;
      } else out[k] = (v !== null && typeof v === 'object') ? clone(v) : v;
    }
    return out;
  }
  setLocal(coll, id, rec) { // rec=null => حذف
    const db = this.getDb();
    if (coll === META_COLL && id === SETTINGS_ID) { const { id: _i, ...rest } = rec || {}; db.settings = rest; return; }
    const arr = db[coll] = db[coll] || []; const i = arr.findIndex(x => x.id === id);
    if (rec === null) { if (i >= 0) arr.splice(i, 1); return; }
    if (i >= 0) arr[i] = rec; else arr.push(rec);
  }
  // استدعاء من مستمع Firestore لكل تغيير. doc=null يعني غير موجود
  async onRemote(coll, id, doc) {
    const key = coll + '/' + id; this.remoteReady.add(coll);
    if (!doc || !ID_RE.test(String(id))) return;
    const b = this.st.base[key];
    if (b && b.rev >= doc.rev) return; // صدى كتابتنا أو نسخة أقدم
    if (this.st.outbox[key]) { // عندنا تعديل غير مرفوع: الدمج يتم وقت الرفع
      this.kick(300); return;
    }
    try {
      if (doc._deleted) { this.setLocal(coll, id, null); this.st.base[key] = { rev: doc.rev, tomb: true }; }
      else {
        const meta = stripMeta(doc); const local = await this.resolveImages(meta);
        const L = this.localRecords().get(key);
        if (L && !b) { // نفس المعرّف موجود محليًا بلا نسخة أساس: دمج بأمان بدل الاستبدال
          const { slim: ls } = slim(L); const r = merge3({}, ls, meta, 0, 1);
          this.logConflicts(key, r.conflicts, 'first-sync');
          if (stable(r.merged) !== stable(meta)) { this.st.base[key] = { rev: doc.rev, rec: clone(meta), updatedAt: doc.updatedAt, createdAt: doc.createdAt }; this.st.outbox[key] = { op: 'set', ts: this.now(), tries: 0 }; this.save(); this.kick(300); return; }
        }
        this.setLocal(coll, id, local);
        this.st.base[key] = { rev: doc.rev, rec: clone(meta), updatedAt: doc.updatedAt, createdAt: doc.createdAt };
      }
      this.save(); this.onChange(); this.emit();
    } catch (e) { /* صورة لم تصل بعد (أوفلاين): نتجاهل وسيُعاد عند اللقطة التالية */ }
  }

  // ----- الرفع -----
  async pushKey(key) {
    const [coll, ...rest] = key.split('/'); const id = rest.join('/'); const ob = this.st.outbox[key];
    const L = this.localRecords().get(key);
    if (ob.op === 'set' && !L) { delete this.st.outbox[key]; return; }
    let images = {}, localSlim = null;
    if (ob.op === 'set') { const s = slim(L); localSlim = s.slim; images = s.images; for (const [m, d] of Object.entries(images)) await this.backend.putImage(imgIdOf(m), d); }
    const base = this.st.base[key]; const lt = ob.unknownBase ? 0 : ob.ts; const now = this.now();
    const res = await this.backend.runTxn(coll, id, remote => {
      if (ob.op === 'set') {
        if (!remote) return { write: { ...localSlim, id, rev: 1, updatedAt: now, createdAt: now }, result: { rev: 1, rec: localSlim, updatedAt: now, createdAt: now } };
        const rrec = stripMeta(remote);
        if (remote._deleted) { // تعديل محلي مقابل حذف بعيد: نحتفظ بالسجل (لا نفقد بيانات)
          const w = { ...localSlim, id, rev: remote.rev + 1, updatedAt: now, createdAt: remote.createdAt || now };
          return { write: w, result: { rev: w.rev, rec: localSlim, updatedAt: now, createdAt: w.createdAt, log: [{ field: '*', lost: 'remote', value: 'delete-vs-edit' }] } };
        }
        if (base && !base.tomb && base.rev === remote.rev) {
          const w = { ...localSlim, id, rev: remote.rev + 1, updatedAt: now, createdAt: remote.createdAt || now };
          return { write: w, result: { rev: w.rev, rec: localSlim, updatedAt: now, createdAt: w.createdAt } };
        }
        const { merged, conflicts } = merge3(base && !base.tomb ? base.rec : {}, localSlim, rrec, lt, remote.updatedAt || 0);
        if (stable(merged) === stable(rrec)) return { write: null, result: { rev: remote.rev, rec: rrec, updatedAt: remote.updatedAt, createdAt: remote.createdAt, log: conflicts, adopt: true } };
        const w = { ...merged, id, rev: remote.rev + 1, updatedAt: now, createdAt: remote.createdAt || now };
        return { write: w, result: { rev: w.rev, rec: merged, updatedAt: now, createdAt: w.createdAt, log: conflicts, merged: true } };
      }
      // حذف
      if (!remote) return { write: null, result: { gone: true } };
      if (remote._deleted) return { write: null, result: { rev: remote.rev, gone: true } };
      if (base && !base.tomb && base.rev === remote.rev) {
        const w = { id, rev: remote.rev + 1, updatedAt: now, createdAt: remote.createdAt || now, _deleted: true };
        return { write: w, result: { rev: w.rev, gone: true } };
      }
      return { write: null, result: { restore: stripMeta(remote), rev: remote.rev, updatedAt: remote.updatedAt, createdAt: remote.createdAt, log: [{ field: '*', lost: 'local', value: 'edit-vs-delete' }] } };
    });
    // ما بعد نجاح العملية
    if (res.log?.length) this.logConflicts(key, res.log, 'push');
    if (ob.op === 'del') {
      if (res.restore) { const loc = await this.resolveImages(res.restore); this.setLocal(coll, id, loc); this.st.base[key] = { rev: res.rev, rec: clone(res.restore), updatedAt: res.updatedAt, createdAt: res.createdAt }; this.onChange(); }
      else this.st.base[key] = { rev: res.rev || (base?.rev || 0), tomb: true };
    } else {
      this.st.base[key] = { rev: res.rev, rec: clone(res.rec), updatedAt: res.updatedAt, createdAt: res.createdAt };
      if (res.merged || res.adopt || res.log?.length) { const loc = await this.resolveImages(res.rec); this.setLocal(coll, id, loc); this.onChange(); }
    }
    // لو المستخدم عدّل نفس السجل أثناء الرفع، يفضل في القائمة
    const cur = this.st.outbox[key]; if (cur === ob) delete this.st.outbox[key];
  }
  isNetErr(e) { const c = e && e.code; return !this.isOnline() || ['unavailable', 'deadline-exceeded', 'network-request-failed', 'cancelled', 'offline'].includes(c) || /offline|network|fetch/i.test(String(e && e.message)); }
  async flush() {
    if (this.running || !this.ready || this.paused) return;
    this.running = true; this.errState = null; this.emit();
    try {
      this.scan();
      for (const key of Object.keys(this.st.outbox)) {
        const ob = this.st.outbox[key]; if (!ob) continue;
        if (ob.tries >= MAX_TRIES) { this.errState = 'فشل متكرر في حفظ ' + key.split('/')[0]; continue; }
        try { await this.pushKey(key); this.save(); }
        catch (e) {
          if (e && e.code === 'permission-denied') { this.errState = 'الصلاحيات ترفض الحفظ — راجع قواعد Firestore وحساب الدكتور'; this.paused = true; this.save(); break; }
          if (this.isNetErr(e)) { this.save(); this.running = false; this.emit(); this.kick(8000); return; }
          ob.tries = (ob.tries || 0) + 1; this.errState = 'تعذر الحفظ: ' + (e && e.code || e && e.message || 'خطأ'); this.save();
          this.running = false; this.emit(); this.kick(Math.min(60000, 2000 * 2 ** ob.tries)); return;
        }
      }
      if (!this.pending()) { this.st.lastSyncAt = this.now(); this.errState = null; this.save(); }
    } finally { this.running = false; this.emit(); }
    if (this.pending() && !this.errState) this.kick(1500);
  }
  // إعادة محاولة يدوية (زر)
  retry() { this.paused = false; this.errState = null; for (const o of Object.values(this.st.outbox)) o.tries = 0; this.save(); this.emit(); return this.flush(); }
  start() { this.ready = true; this.paused = false; this.scan(); this.emit(); this.kick(200); }
  stop() { this.ready = false; this.emit(); }
}
