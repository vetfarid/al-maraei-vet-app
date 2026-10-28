import test from 'node:test'; import assert from 'node:assert/strict';
import { validateBackup, makeBackup, applyImport, diffSummary, migrateLegacy, money, emptyDb } from '../lib/backup.js';
const good = () => ({ ...emptyDb(), patients: [{ id: 'p1', name: 'ريكس', vaccines: [{ id: 'v', date: '2026-01-01', nextDate: '2026-02-01' }] }], appointments: [{ id: 'a1', date: '2026-10-30', time: '10:00' }], finance: [{ id: 'f1', type: 'in', amount: '١٢٠٫٥' }, { id: 'f2', type: 'out', amount: '' }] });
test('نسخة سليمة تُقبل ومصدّرة ثم مستوردة تعطي نفس البيانات', () => {
  const b = makeBackup(good()); const r = validateBackup(JSON.parse(JSON.stringify(b))); assert.ok(r.ok, r.errors.join()); assert.equal(r.db.patients[0].id, 'p1');
});
test('نسخة تالفة ترفض بدون تغيير', () => {
  assert.equal(validateBackup(null).ok, false); assert.equal(validateBackup([]).ok, false); assert.equal(validateBackup({ patients: 1 }).ok, false);
  const b = makeBackup(good()); b.data.finance[0].amount = '999'; assert.equal(validateBackup(b).ok, false);
  const x = good(); x.finance.push({ id: 'z', type: 'bad', amount: 'abc' }); assert.equal(validateBackup(x).ok, false);
  const y = good(); y.appointments[0].date = '30/10/2026'; assert.equal(validateBackup(y).ok, false);
});
test('القيم المالية: عشرية، فارغة، عربية، غير صالحة', () => {
  assert.equal(money('١٢٠٫٥'), 120.5); assert.equal(money(''), 0); assert.equal(money(null), 0); assert.equal(money('1,250.75'), 1250.75); assert.ok(Number.isNaN(money('abc'))); assert.ok(Number.isNaN(money('1e5x')));
  const net = good().finance.reduce((s, x) => s + (x.type === 'in' ? 1 : -1) * money(x.amount), 0); assert.equal(net, 120.5);
});
test('الاستيراد بالدمج لا يحذف، والاستبدال يستبدل', () => {
  const cur = good(); const inc = { ...emptyDb(), patients: [{ id: 'p2', name: 'ميمي', vaccines: [] }] };
  const m = applyImport(cur, inc, 'merge', () => 'n'); assert.equal(m.patients.length, 2); assert.equal(m.finance.length, 2);
  const r = applyImport(cur, inc, 'replace', () => 'n'); assert.equal(r.patients.length, 1); assert.equal(r.finance.length, 0);
  assert.deepEqual(diffSummary(cur, inc), { add: 1, change: 0, same: 0, onlyLocal: 4 });
});
test('تكرار المعرّفات داخل نسخة يتجاهل المكرر', () => {
  const x = good(); x.patients.push({ ...x.patients[0] }); const r = validateBackup(x); assert.ok(r.ok); assert.equal(r.db.patients.length, 1);
});
test('ترحيل من التصميم القديم يجمع ولا يفقد', () => {
  const local = { ...emptyDb(), patients: [{ id: 'p1', name: 'محلي', vaccines: [] }] };
  const legacy = { ...emptyDb(), patients: [{ id: 'p1', name: 'سحابي', vaccines: [] }, { id: 'p9', name: 'جديد', vaccines: [] }] };
  const a = migrateLegacy(local, legacy, { localDirty: true }); assert.equal(a.db.patients.length, 2); assert.equal(a.db.patients[0].name, 'محلي');
  const b = migrateLegacy(local, legacy, { localDirty: false }); assert.equal(b.db.patients[0].name, 'سحابي'); assert.equal(b.stats.fromLegacy, 1);
});
test('سجل بصورة كبيرة يعدي التحقق', () => {
  const x = good(); x.patients[0].photo = 'data:image/jpeg;base64,' + 'A'.repeat(800000); assert.ok(validateBackup(makeBackup(x)).ok);
});
