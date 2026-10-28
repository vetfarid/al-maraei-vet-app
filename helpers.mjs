import { SyncEngine, MemStore, stable } from '../lib/sync-core.js';
// خلفية وهمية في الذاكرة تحاكي Firestore: معاملات + قاعدة rev+1 + انقطاع شبكة + ضياع الرد بعد الالتزام
export class FakeCloud {
  constructor() { this.docs = new Map(); this.images = new Map(); this.down = false; this.denied = false; this.dropAckOnce = false; this.writes = 0; }
  backendFor() {
    const c = this;
    const chk = () => { if (c.denied) throw Object.assign(new Error('denied'), { code: 'permission-denied' }); if (c.down) throw Object.assign(new Error('offline'), { code: 'unavailable' }); };
    return {
      async runTxn(coll, id, fn) {
        chk(); const k = coll + '/' + id; const cur = c.docs.get(k); const remote = cur ? JSON.parse(JSON.stringify(cur)) : null;
        const { write, result } = fn(remote);
        if (write) { // نفس قاعدة الأمان: rev لازم يساوي القديم+1
          const expect = cur ? cur.rev + 1 : 1; if (write.rev !== expect) throw Object.assign(new Error('rev'), { code: 'permission-denied' });
          c.docs.set(k, JSON.parse(JSON.stringify(write))); c.writes++;
          if (c.dropAckOnce) { c.dropAckOnce = false; throw Object.assign(new Error('offline'), { code: 'unavailable' }); }
        }
        return result;
      },
      async getImage(id) { chk(); return c.images.get(id) || null; },
      async putImage(id, d) { chk(); c.images.set(id, d); }
    };
  }
}
export function mkClient(cloud, init = {}) {
  const store = new MemStore(); let t = 1000;
  const db = { patients: [], appointments: [], finance: [], chicks: [], batches: [], shortages: [], orders: [], companies: [], debts: [], settings: {}, ...init };
  const clk = { now: () => ++t, set: v => (t = v) };
  const eng = new SyncEngine({ getDb: () => db, store, backend: cloud.backendFor(), now: clk.now, schedule: () => 0, isOnline: () => !cloud.down });
  eng.ready = true;
  return { db, eng, store, clk };
}
// يمرر كل مستندات السحابة للعميل كأنها لقطة Firestore
export async function pull(cloud, cl) { for (const [k, d] of cloud.docs) { const [c, ...r] = k.split('/'); await cl.eng.onRemote(c, r.join('/'), JSON.parse(JSON.stringify(d))); } }
export async function syncAll(cloud, ...cls) { for (let i = 0; i < 2; i++) for (const cl of cls) { cl.eng.paused = false; await cl.eng.flush(); await pull(cloud, cl); } }
export { stable };
