import test from 'node:test'; import assert from 'node:assert/strict';
import { FakeCloud, mkClient, pull, syncAll } from './helpers.mjs';
import { merge3 } from '../lib/sync-core.js';
const BIG = 'data:image/jpeg;base64,' + 'A'.repeat(600000);

test('إنشاء وتعديل وحذف سجل ينتقل لجهاز آخر', async () => {
  const cloud = new FakeCloud(), A = mkClient(cloud), B = mkClient(cloud);
  A.db.patients.push({ id: 'p1', name: 'ريكس', owner: 'أحمد', vaccines: [] }); A.eng.localChanged();
  await syncAll(cloud, A, B); assert.equal(B.db.patients.length, 1); assert.equal(B.db.patients[0].name, 'ريكس');
  A.db.patients[0].name = 'ريكس٢'; A.eng.localChanged(); await syncAll(cloud, A, B); assert.equal(B.db.patients[0].name, 'ريكس٢');
  A.db.patients.length = 0; A.eng.localChanged(); await syncAll(cloud, A, B); assert.equal(B.db.patients.length, 0);
  assert.equal(cloud.docs.get('patients/p1')._deleted, true); assert.equal(Object.keys(cloud.docs.get('patients/p1')).includes('name'), false);
});
test('تعديلان من جهازين على حقلين مختلفين يندمجان بلا فقد', async () => {
  const cloud = new FakeCloud(), A = mkClient(cloud), B = mkClient(cloud);
  A.db.patients.push({ id: 'p1', name: 'x', phone: '010', vaccines: [] }); A.eng.localChanged(); await syncAll(cloud, A, B);
  A.db.patients[0].name = 'اسم جديد'; B.db.patients[0].phone = '011'; A.eng.localChanged(); B.eng.localChanged();
  await syncAll(cloud, A, B);
  for (const c of [A, B]) { assert.equal(c.db.patients[0].name, 'اسم جديد'); assert.equal(c.db.patients[0].phone, '011'); }
});
test('تعارض على نفس الحقل: الأحدث يكسب والخاسر يتسجل', async () => {
  const cloud = new FakeCloud(), A = mkClient(cloud), B = mkClient(cloud);
  A.db.patients.push({ id: 'p1', name: 'x', vaccines: [] }); A.eng.localChanged(); await syncAll(cloud, A, B);
  A.clk.set(5000); B.clk.set(9000);
  A.db.patients[0].name = 'من A'; A.eng.localChanged(); B.db.patients[0].name = 'من B'; B.eng.localChanged();
  await syncAll(cloud, A, B);
  assert.equal(A.db.patients[0].name, B.db.patients[0].name);
  assert.ok(A.eng.st.conflicts.length + B.eng.st.conflicts.length >= 1);
});
test('إضافة تطعيمين من جهازين لنفس الحيوان: الاثنان يبقيان', async () => {
  const cloud = new FakeCloud(), A = mkClient(cloud), B = mkClient(cloud);
  A.db.patients.push({ id: 'p1', name: 'x', vaccines: [] }); A.eng.localChanged(); await syncAll(cloud, A, B);
  A.db.patients[0].vaccines.push({ id: 'v1', label: 'سعار' }); B.db.patients[0].vaccines.push({ id: 'v2', label: 'ديدان' });
  A.eng.localChanged(); B.eng.localChanged(); await syncAll(cloud, A, B);
  assert.deepEqual(A.db.patients[0].vaccines.map(v => v.id).sort(), ['v1', 'v2']); assert.deepEqual(B.db.patients[0].vaccines.map(v => v.id).sort(), ['v1', 'v2']);
});
test('انقطاع الشبكة: التعديل يبقى معلقًا ثم يُرفع بدون تكرار', async () => {
  const cloud = new FakeCloud(), A = mkClient(cloud); cloud.down = true;
  A.db.finance.push({ id: 'f1', type: 'in', amount: '100.5' }); A.eng.localChanged(); await A.eng.flush();
  assert.equal(A.eng.pending(), 1); assert.equal(A.eng.status().state, 'offline'); assert.equal(A.db.finance.length, 1);
  cloud.down = false; await A.eng.flush(); assert.equal(A.eng.pending(), 0); assert.equal(cloud.docs.size, 1);
});
test('ضياع الرد بعد نجاح الكتابة ثم إعادة المحاولة لا يكرر ولا يضاعف المالية', async () => {
  const cloud = new FakeCloud(), A = mkClient(cloud); cloud.dropAckOnce = true;
  A.db.finance.push({ id: 'f1', type: 'in', amount: '200' }); A.eng.localChanged(); await A.eng.flush(); await A.eng.flush();
  assert.equal(A.eng.pending(), 0); assert.equal([...cloud.docs.keys()].filter(k => k.startsWith('finance/')).length, 1);
  const B = mkClient(cloud); await pull(cloud, B); assert.equal(B.db.finance.reduce((s, x) => s + Number(x.amount), 0), 200);
});
test('رفض الصلاحيات يوقف المحاولات ولا يمسح النسخة المحلية', async () => {
  const cloud = new FakeCloud(), A = mkClient(cloud); cloud.denied = true;
  A.db.debts.push({ id: 'd1', amount: '5' }); A.eng.localChanged(); await A.eng.flush();
  assert.equal(A.eng.status().state, 'error'); assert.equal(A.db.debts.length, 1); assert.equal(A.eng.pending(), 1);
  cloud.denied = false; await A.eng.retry(); assert.equal(A.eng.pending(), 0);
});
test('صورة كبيرة تُفصل في مستند صور منفصل والسجل يبقى صغيرًا', async () => {
  const cloud = new FakeCloud(), A = mkClient(cloud), B = mkClient(cloud);
  A.db.patients.push({ id: 'p1', name: 'x', photo: BIG, vaccines: [] }); A.eng.localChanged(); await syncAll(cloud, A, B);
  assert.ok(JSON.stringify(cloud.docs.get('patients/p1')).length < 2000); assert.equal(cloud.images.size, 1);
  assert.equal(B.db.patients[0].photo, BIG);
});
test('حذف من جهاز مقابل تعديل أحدث من جهاز آخر: السجل يبقى', async () => {
  const cloud = new FakeCloud(), A = mkClient(cloud), B = mkClient(cloud);
  A.db.patients.push({ id: 'p1', name: 'x', vaccines: [] }); A.eng.localChanged(); await syncAll(cloud, A, B);
  B.db.patients[0].name = 'معدّل'; B.eng.localChanged(); await B.eng.flush();
  A.db.patients.length = 0; A.eng.localChanged(); await syncAll(cloud, A, B);
  assert.equal(A.db.patients.length, 1); assert.equal(A.db.patients[0].name, 'معدّل');
});
test('بيانات محلية قديمة لا تستبدل بيانات السحابة الأحدث (لا يوجد base)', async () => {
  const cloud = new FakeCloud(), A = mkClient(cloud); A.db.patients.push({ id: 'p1', name: 'جديد', vaccines: [] }); A.eng.localChanged(); await A.eng.flush();
  const stale = mkClient(cloud, { patients: [{ id: 'p1', name: 'قديم', vaccines: [] }] }); stale.eng.scan(); await pull(cloud, stale); await syncAll(cloud, stale, A);
  assert.equal(stale.db.patients[0].name, 'جديد'); assert.equal(A.db.patients[0].name, 'جديد'); assert.ok(stale.eng.st.conflicts.length >= 1);
});
test('تحميل أول مرة: سجلات محلية فقط تُرفع وسجلات سحابية فقط تُضاف', async () => {
  const cloud = new FakeCloud(), A = mkClient(cloud); A.db.companies.push({ id: 'c1', name: 'شركة' }); A.eng.localChanged(); await A.eng.flush();
  const B = mkClient(cloud, { shortages: [{ id: 's1', name: 'حقن', qty: '3' }] }); B.eng.scan(); await syncAll(cloud, B, A);
  assert.equal(B.db.companies.length, 1); assert.equal(A.db.shortages.length, 1);
});
test('merge3: مصفوفة بدون تعارض', () => {
  const r = merge3({ a: [1] }, { a: [1, 2] }, { a: [1, 3] }, 1, 2); assert.deepEqual(r.merged.a.sort(), [1, 2, 3]);
});
