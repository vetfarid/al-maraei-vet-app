// خادم Firestore/Auth وهمي في Node + محاكاة مبسطة لقواعد الأمان (ليست القواعد الحقيقية — الاختبار الحقيقي للقواعد يحتاج Emulator).
const ID_OK = /^[A-Za-z0-9_\-:.]{1,80}$/;
const REC = new Set(['patients','appointments','finance','manualRequests','chicks','batches','shortages','orders','companies','debts','meta']);
const REQ_KEYS = ['name','phone','animalType','animalName','type','date','time','address','details','status','createdAt','ownerUid'];
const REQ_ALL = ['name','phone','type','details','status','createdAt','ownerUid'];
export class FakeServer {
  constructor() { this.docs = new Map(); this.ver = new Map(); this.users = new Map(); this.down = false; this.log = []; this.now = () => Date.now(); }
  err(code) { return Object.assign(new Error(code), { code }); }
  addDoctor(email, pw, uid) { this.users.set(email, { pw, uid }); this.docs.set('admins/' + uid, { ok: true }); }
  isDoctor(u) { return !!u && !u.isAnonymous && this.docs.has('admins/' + u.uid); }
  split(path) { const p = path.split('/'); return { coll: p[0], id: p[1] }; }
  canRead(u, path, doc, listWheres) {
    const { coll, id } = this.split(path);
    if (coll === 'admins') return !!u && u.uid === id;
    if (REC.has(coll) || coll === 'images' || coll === 'clinic') return this.isDoctor(u);
    if (coll === 'public') return id === 'page';
    if (coll === 'publicImages') return true;
    if (coll === 'requests') { if (this.isDoctor(u)) return true; if (!u) return false; if (listWheres) return listWheres.some(w => w[0] === 'ownerUid' && w[1] === '==' && w[2] === u.uid); return !!doc && doc.ownerUid === u.uid; }
    return false;
  }
  canWrite(u, type, path, nd, od) {
    const { coll, id } = this.split(path), doc = this.isDoctor(u);
    if (REC.has(coll)) { if (!doc) return false; if (type === 'delete') return true; return nd.id === id && Number.isInteger(nd.rev) && nd.rev === (od ? od.rev + 1 : 1) && typeof nd.updatedAt === 'number' && ID_OK.test(id); }
    if (coll === 'images') return doc && (type === 'delete' || (typeof nd.data === 'string' && nd.data.length <= 900000 && /^data:image\//.test(nd.data)));
    if (coll === 'publicImages') return doc;
    if (coll === 'public') return doc && id === 'page' && type !== 'delete';
    if (coll === 'requests') {
      if (type === 'create') { if (!u) return false; const k = Object.keys(nd); return REQ_ALL.every(x => k.includes(x)) && k.every(x => REQ_KEYS.includes(x)) && nd.ownerUid === u.uid && nd.status === 'جديد' && /^01[0125][0-9]{8}$/.test(nd.phone) && typeof nd.details === 'string' && nd.details.length <= 1500 && nd.name.length <= 100 && nd.createdAt && nd.createdAt.__t; }
      if (type === 'update') { if (!doc) return false; const ch = Object.keys(nd).filter(k => JSON.stringify(nd[k]) !== JSON.stringify(od[k])); return ch.every(k => ['status', 'reply', 'repliedAt'].includes(k)); }
      return doc;
    }
    return false;
  }
  resolve(v) { if (v && v.__sv === 'ts') return { __t: this.now() }; if (Array.isArray(v)) return v.map(x => this.resolve(x)); if (v && typeof v === 'object' && !v.__t) { const o = {}; for (const k of Object.keys(v)) o[k] = this.resolve(v[k]); return o; } return v; }
  call(op, a) {
    if (this.down) throw this.err('unavailable');
    const u = a.user || null;
    if (op === 'signIn') { const r = this.users.get(a.email); if (!r || r.pw !== a.pw) throw this.err('auth/invalid-credential'); return { uid: r.uid, email: a.email, isAnonymous: false }; }
    if (op === 'get') { const d = this.docs.get(a.path); if (!this.canRead(u, a.path, d)) throw this.err('permission-denied'); return { exists: !!d, data: d ? JSON.parse(JSON.stringify(d)) : null, v: this.ver.get(a.path) || 0 }; }
    if (op === 'list') {
      if (!this.canRead(u, a.coll + '/x', null, a.wheres || [])) throw this.err('permission-denied');
      let out = [...this.docs].filter(([p]) => p.startsWith(a.coll + '/') && p.split('/').length === 2).map(([p, d]) => ({ id: p.split('/')[1], data: d }));
      for (const [f, o, v] of (a.wheres || [])) out = out.filter(x => o === '==' && x.data[f] === v);
      if (a.order) out.sort((x, y) => ((x.data[a.order[0]]?.__t ?? x.data[a.order[0]] ?? 0) - (y.data[a.order[0]]?.__t ?? y.data[a.order[0]] ?? 0)) * (a.order[1] === 'desc' ? -1 : 1));
      return JSON.parse(JSON.stringify(out));
    }
    if (op === 'commit') {
      for (const [p, v] of Object.entries(a.reads || {})) if ((this.ver.get(p) || 0) !== v) throw this.err('aborted');
      const plan = [];
      for (const w of a.writes) {
        const od = this.docs.get(w.path) || null;
        if (w.type === 'update' && !od) throw this.err('not-found');
        const nd = w.type === 'delete' ? null : this.resolve(w.type === 'update' ? { ...od, ...w.data } : w.data);
        const ty = w.type === 'delete' ? 'delete' : (od ? 'update' : 'create');
        if (!this.canWrite(u, ty, w.path, nd, od)) throw this.err('permission-denied');
        plan.push([w.path, nd]);
      }
      for (const [p, nd] of plan) { if (nd === null) this.docs.delete(p); else this.docs.set(p, nd); this.ver.set(p, (this.ver.get(p) || 0) + 1); }
      return true;
    }
    throw this.err('unimplemented');
  }
}
