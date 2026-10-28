// التحقق من النسخ الاحتياطية، التصدير، الاستيراد (دمج/استبدال)، وترحيل التصميم القديم — بدون DOM.
import { COLLS, ID_RE, cyrb53, stable } from './sync-core.js';
export const BACKUP_FORMAT = 'maraei-backup', BACKUP_VERSION = 3;
const ALL = COLLS;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const num = v => v === '' || v == null || (typeof v === 'number' ? Number.isFinite(v) : (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(toLatin(v).trim())));
export const toLatin = s => String(s ?? '').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/٫/g, '.');
// تحويل مالي آمن: أرقام عربية، فواصل، قيم فارغة => 0، غير صالح => NaN
export function money(v) {
  if (v == null || v === '') return 0; if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  const t = toLatin(v).replace(/[,\s٬]/g, ''); return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}
export const isPlainObj = o => o && typeof o === 'object' && !Array.isArray(o);

// يرجع {ok, errors[], warnings[], db, counts}. لا يعدّل الكائن المدخل.
export function validateBackup(raw) {
  const errors = [], warnings = [];
  if (!isPlainObj(raw)) return { ok: false, errors: ['الملف ليس نسخة احتياطية صالحة'], warnings, db: null, counts: {} };
  let d = raw;
  if (raw.format === BACKUP_FORMAT) {
    if (!isPlainObj(raw.data)) return { ok: false, errors: ['محتوى النسخة مفقود'], warnings, db: null, counts: {} };
    if (typeof raw.version !== 'number' || raw.version > BACKUP_VERSION) errors.push('النسخة من إصدار أحدث من التطبيق');
    if (raw.checksum && raw.checksum !== checksum(raw.data)) errors.push('الملف تالف أو تم تعديله (فشل فحص السلامة)');
    d = raw.data;
  }
  for (const k of ['patients', 'appointments', 'finance']) if (!Array.isArray(d[k])) errors.push('القسم "' + k + '" مفقود أو غير صالح');
  const db = { settings: {} }, counts = {}, seen = new Set();
  for (const c of ALL) {
    const arr = d[c]; if (arr === undefined) { db[c] = []; counts[c] = 0; continue; }
    if (!Array.isArray(arr)) { errors.push('القسم "' + c + '" ليس قائمة'); continue; }
    const out = [];
    arr.forEach((r, i) => {
      if (!isPlainObj(r)) { errors.push(c + '[' + i + '] سجل غير صالح'); return; }
      if (r.id == null || r.id === '') { warnings.push(c + '[' + i + '] بدون معرّف — سيتم إنشاء معرّف'); } else if (typeof r.id !== 'string' || !ID_RE.test(r.id)) { errors.push(c + '[' + i + '] معرّف غير آمن'); return; }
      const key = c + '/' + r.id; if (r.id && seen.has(key)) { warnings.push('معرّف مكرر في ' + c + ' تم تجاهل التكرار'); return; } if (r.id) seen.add(key);
      if (c === 'finance') { if (r.type !== 'in' && r.type !== 'out') errors.push('finance[' + i + '] نوع الحركة غير صالح'); if (!num(r.amount) || Number.isNaN(money(r.amount))) errors.push('finance[' + i + '] مبلغ غير صالح'); }
      if (c === 'appointments' && r.date && !DATE_RE.test(toLatin(r.date))) errors.push('appointments[' + i + '] تاريخ غير صالح');
      if (c === 'patients') { if (r.vaccines !== undefined && !Array.isArray(r.vaccines)) errors.push('patients[' + i + '] التطعيمات ليست قائمة'); for (const v of (r.vaccines || [])) { if (!isPlainObj(v)) errors.push('patients[' + i + '] تطعيم غير صالح'); else for (const f of ['date', 'nextDate']) if (v[f] && !DATE_RE.test(v[f])) errors.push('patients[' + i + '] تاريخ تطعيم غير صالح'); } }
      for (const f of ['amount', 'total', 'paid']) if (r[f] !== undefined && r[f] !== '' && Number.isNaN(money(r[f]))) errors.push(c + '[' + i + '] قيمة رقمية غير صالحة في ' + f);
      out.push(r);
    });
    db[c] = out; counts[c] = out.length;
  }
  if (d.settings !== undefined) { if (isPlainObj(d.settings)) db.settings = d.settings; else errors.push('الإعدادات غير صالحة'); }
  return { ok: errors.length === 0, errors: errors.slice(0, 20), warnings: warnings.slice(0, 20), db: errors.length ? null : db, counts };
}
export const checksum = data => cyrb53(stable(data)).toString(36);
export function makeBackup(db, meta = {}) {
  const data = JSON.parse(JSON.stringify(db));
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), checksum: checksum(data), ...meta, data };
}
// دمج: يضيف/يحدّث بالمعرّف فقط ولا يحذف شيئًا. replaceMode: يستبدل المحلي بالكامل (يستخدمه المستخدم بتأكيد صريح)
export function diffSummary(cur, inc) {
  const s = { add: 0, change: 0, same: 0, onlyLocal: 0 };
  for (const c of ALL) {
    const m = new Map((cur[c] || []).map(r => [r.id, r])), n = new Map((inc[c] || []).map(r => [r.id, r]));
    for (const [id, r] of n) { const o = m.get(id); if (!o) s.add++; else if (stable(o) === stable(r)) s.same++; else s.change++; }
    for (const id of m.keys()) if (!n.has(id)) s.onlyLocal++;
  }
  return s;
}
export function applyImport(cur, inc, mode, uuid) {
  const next = JSON.parse(JSON.stringify(mode === 'replace' ? { ...emptyDb(), ...inc } : cur));
  if (mode !== 'replace') {
    for (const c of ALL) { const arr = next[c] = next[c] || []; for (const r of (inc[c] || [])) { const rec = JSON.parse(JSON.stringify(r)); if (!rec.id) rec.id = uuid(); const i = arr.findIndex(x => x.id === rec.id); if (i >= 0) arr[i] = rec; else arr.push(rec); } }
    next.settings = { ...(next.settings || {}), ...(inc.settings || {}) };
  } else for (const c of ALL) for (const r of next[c]) if (!r.id) r.id = uuid();
  return next;
}
export const emptyDb = () => ({ patients: [], appointments: [], finance: [], requests: [], chicks: [], batches: [], shortages: [], orders: [], companies: [], debts: [], settings: {} });
// ترحيل من المستند القديم clinic/data (JSON واحد) إلى السجلات: اتحاد بالمعرّف بدون حذف أي شيء
export function migrateLegacy(local, legacy, { localDirty }) {
  const out = JSON.parse(JSON.stringify(local)), st = { fromLegacy: 0, kept: 0, conflicts: 0 };
  for (const c of ALL) {
    const arr = out[c] = out[c] || [];
    for (const r of (legacy[c] || [])) {
      if (!r || !r.id) continue; const i = arr.findIndex(x => x.id === r.id);
      if (i < 0) { arr.push(JSON.parse(JSON.stringify(r))); st.fromLegacy++; }
      else if (stable(arr[i]) !== stable(r)) { st.conflicts++; if (!localDirty) arr[i] = JSON.parse(JSON.stringify(r)); else st.kept++; }
    }
  }
  out.settings = { ...(legacy.settings || {}), ...(out.settings || {}) };
  return { db: out, stats: st };
}
