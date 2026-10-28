// اختبارات قواعد Firestore الحقيقية — تحتاج Firebase Emulator (لم تُنفَّذ في بيئة التطوير لعدم توفر الإنترنت):
//   npm install && npm run test:rules
import test, { before, after, beforeEach } from 'node:test'; import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection, query, where, serverTimestamp } from 'firebase/firestore';
let env;
before(async () => { env = await initializeTestEnvironment({ projectId: 'maraei-rules-test', firestore: { rules: fs.readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } }); });
after(async () => env.cleanup());
beforeEach(async () => { await env.clearFirestore(); await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), 'admins/DOC'), { ok: true }); await setDoc(doc(c.firestore(), 'requests/r1'), { name: 'أحمد', phone: '01012345678', type: 'استفسار', details: 'x', status: 'جديد', createdAt: new Date(), ownerUid: 'cust1' }); await setDoc(doc(c.firestore(), 'patients/p1'), { id: 'p1', rev: 1, updatedAt: 1, name: 'ريكس' }); await setDoc(doc(c.firestore(), 'public/page'), { title: 't' }); }); });
const doctor = () => env.authenticatedContext('DOC', { firebase: { sign_in_provider: 'password' } }).firestore();
const notDoctor = () => env.authenticatedContext('X', { firebase: { sign_in_provider: 'password' } }).firestore();
const cust = (u = 'cust1') => env.authenticatedContext(u, { firebase: { sign_in_provider: 'anonymous' } }).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const req = (o = {}) => ({ name: 'عميل', phone: '01012345678', type: 'استفسار', details: 'تفاصيل', status: 'جديد', createdAt: serverTimestamp(), ownerUid: 'cust1', ...o });

test('الدكتور فقط يقرأ ويكتب السجلات الطبية والمالية', async () => {
  await assertSucceeds(getDoc(doc(doctor(), 'patients/p1'))); await assertFails(getDoc(doc(notDoctor(), 'patients/p1'))); await assertFails(getDoc(doc(cust(), 'patients/p1'))); await assertFails(getDoc(doc(anon(), 'patients/p1')));
  await assertSucceeds(setDoc(doc(doctor(), 'finance/f1'), { id: 'f1', rev: 1, updatedAt: 1, amount: '5', type: 'in' })); await assertFails(setDoc(doc(cust(), 'finance/f2'), { id: 'f2', rev: 1, updatedAt: 1 }));
});
test('الكتابة فوق تعديل أحدث ترفض (rev لازم +1)', async () => {
  await assertFails(setDoc(doc(doctor(), 'patients/p1'), { id: 'p1', rev: 1, updatedAt: 2, name: 'x' })); await assertSucceeds(setDoc(doc(doctor(), 'patients/p1'), { id: 'p1', rev: 2, updatedAt: 2, name: 'x' }));
});
test('العميل ينشئ طلبه فقط بالحقول المسموحة', async () => {
  await assertSucceeds(setDoc(doc(cust(), 'requests/new1'), req())); await assertFails(setDoc(doc(cust(), 'requests/n2'), req({ status: 'تم الرد' }))); await assertFails(setDoc(doc(cust(), 'requests/n3'), req({ reply: 'x' })));
  await assertFails(setDoc(doc(cust(), 'requests/n4'), req({ ownerUid: 'other' }))); await assertFails(setDoc(doc(cust(), 'requests/n5'), req({ phone: '123' }))); await assertFails(setDoc(doc(cust(), 'requests/n6'), req({ extra: 1 }))); await assertFails(setDoc(doc(anon(), 'requests/n7'), req()));
});
test('العميل يقرأ طلبه فقط ولا يقرأ طلبات غيره ولا القائمة الكاملة', async () => {
  await assertSucceeds(getDoc(doc(cust('cust1'), 'requests/r1'))); await assertFails(getDoc(doc(cust('cust2'), 'requests/r1'))); await assertFails(getDocs(collection(cust('cust2'), 'requests')));
  await assertSucceeds(getDocs(query(collection(cust('cust1'), 'requests'), where('ownerUid', '==', 'cust1')))); await assertSucceeds(getDocs(collection(doctor(), 'requests')));
});
test('العميل لا يعدّل الحالة أو الرد ولا يحذف، والدكتور يرد', async () => {
  await assertFails(updateDoc(doc(cust(), 'requests/r1'), { status: 'تم الرد', reply: 'x' })); await assertFails(deleteDoc(doc(cust(), 'requests/r1')));
  await assertSucceeds(updateDoc(doc(doctor(), 'requests/r1'), { status: 'تم الرد', reply: 'أهلًا', repliedAt: 1 })); await assertFails(updateDoc(doc(doctor(), 'requests/r1'), { name: 'تغيير' }));
});
test('صفحة العملاء: قراءة عامة وكتابة الدكتور فقط', async () => {
  await assertSucceeds(getDoc(doc(anon(), 'public/page'))); await assertFails(setDoc(doc(cust(), 'public/page'), { title: 'h' })); await assertSucceeds(setDoc(doc(doctor(), 'public/page'), { title: 'ok', imageIds: [] })); await assertFails(setDoc(doc(doctor(), 'public/page'), { title: 'ok', pageUrl: 'javascript:alert(1)' }));
});
test('المستند القديم clinic/data: قراءة الدكتور فقط وبدون كتابة', async () => {
  await assertFails(setDoc(doc(doctor(), 'clinic/data'), { json: '{}' })); await assertFails(getDoc(doc(cust(), 'clinic/data')));
});
test('admins: لا يُكتب من التطبيق', async () => { await assertFails(setDoc(doc(doctor(), 'admins/NEW'), { ok: true })); await assertFails(setDoc(doc(cust(), 'admins/cust1'), { ok: true })); });
