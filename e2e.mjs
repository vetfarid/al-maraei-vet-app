// اختبارات المتصفح (Chromium عبر Playwright) — بدون إنترنت ولا Firebase حقيقي: Firebase مستبدل بخادم وهمي (tests/fakeserver.mjs)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module'; import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/home/claude/.npm-global/lib/node_modules/playwright');
import { FakeServer } from './fakeserver.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); r.end(fs.readFileSync(f)); });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const BASE = 'http://127.0.0.1:' + server.address().port;
const srv = new FakeServer(); srv.addDoctor('doctor@test.local', 'pw123456', 'DOC1'); srv.addDoctor('doctor2@test.local', 'pw123456', 'DOC2');
const browser = await chromium.launch();
const results = []; let failed = 0;
const T = async (name, fn) => { try { srv.down = false; await fn(); results.push(['PASS', name]); console.log('PASS', name); } catch (e) { failed++; results.push(['FAIL', name + ' :: ' + String(e.message).split('\n')[0]]); console.log('FAIL', name, '\n   ', String(e.stack).split('\n').slice(0, 4).join('\n    ')); } };
async function newCtx(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, serviceWorkers: 'block', ...opts });
  await ctx.exposeBinding('__fakeCall', async (_s, op, a) => { try { return { ok: srv.call(op, a) }; } catch (e) { return { err: e.code || e.message }; } });
  await ctx.addInitScript(() => { const raw = window.__fakeCall; window.__fakeCall = async (op, a) => { const r = await raw(op, a); if (r.err) throw Object.assign(new Error(r.err), { code: r.err }); return r.ok; }; });
  for (const m of ['app', 'auth', 'firestore']) await ctx.route(`https://www.gstatic.com/firebasejs/10.12.2/firebase-${m}.js`, r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(ROOT, 'tests/fake/firebase-' + m + '.js'), 'utf8') }));
  await ctx.route('https://ntfy.sh/**', r => r.fulfill({ status: 200, body: 'ok' }));
  return ctx;
}
async function open(ctx, file) { const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(String(e))); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) p.errs.push(m.text()); }); await p.goto(BASE + '/' + file); await p.waitForTimeout(400); return p; }
const waitFor = async (fn, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise(r => setTimeout(r, 100)); } return false; };
async function login(p, em = 'doctor@test.local', pw = 'pw123456') { await p.evaluate(() => go('requests')); await p.fill('#lgEmail', em); await p.fill('#lgPass', pw); await p.click('#loginForm button[type=submit], #loginForm button'); assert.ok(await waitFor(async () => /تمت المزامنة/.test(await p.textContent('#syncPill')), 8000), 'sync pill: ' + await p.textContent('#syncPill')); }
const docsOf = c => [...srv.docs.keys()].filter(k => k.startsWith(c + '/'));
const addVia = (p, form, vals) => p.evaluate(([f, v]) => { const el = document.getElementById(f); for (const [k, x] of Object.entries(v)) { const i = el.elements[k]; if (i) i.value = x; } el.requestSubmit(); }, [form, vals]);

// ===== 1) الشاشة الصغيرة والأخطاء =====
const ctxA = await newCtx(); const A = await open(ctxA, 'index.html');
await T('تحميل لوحة الإدارة على شاشة 360px بدون أخطاء JS', async () => { assert.equal(JSON.stringify(A.errs), '[]'); const ov = await A.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); assert.ok(ov <= 1, 'overflow ' + ov); assert.equal(await A.getAttribute('html', 'dir'), 'rtl'); });
await T('كل التبويبات تفتح بدون أخطاء ولا تمدد أفقي', async () => { for (const id of ['home', 'patients', 'appointments', 'finance', 'requests', 'buy', 'chicks', 'settings']) { await A.evaluate(i => go(i), id); await A.waitForTimeout(80); const ov = await A.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); assert.ok(ov <= 1, id + ' overflow ' + ov); } assert.equal(JSON.stringify(A.errs), '[]'); });
// ===== 2) الوظائف الأساسية محليًا =====
await T('إضافة ملف حيوان وموعد وحركة مالية محليًا', async () => {
  await addVia(A, 'patientForm', { name: 'ريكس', owner: 'أحمد', kind: 'كلب', phone: '01012345678' });
  await addVia(A, 'apptForm', { animal: 'ريكس', owner: 'أحمد', phone: '01012345678', date: '2026-11-01', time: '10:00', type: 'كشف' });
  await addVia(A, 'finForm', { type: 'in', amount: '120.5', title: 'كشف', date: '2026-10-27' }); await addVia(A, 'finForm', { type: 'out', amount: '20.25', title: 'مصروف', date: '2026-10-27' });
  const db = JSON.parse(await A.evaluate(() => localStorage.getItem('maraei_v2'))); assert.equal(db.patients.length, 1); assert.equal(db.appointments.length, 1); assert.equal(db.finance.length, 2);
  await A.evaluate(() => go('finance')); const net = await A.textContent('#net'); assert.match(net, /100\.25/); assert.equal(JSON.stringify(A.errs), '[]');
});
await T('المالية: قيم فارغة/غير صالحة لا تعطي NaN', async () => {
  await A.evaluate(() => { db.finance.push({ id: 'x1', type: 'in', amount: '', title: 't' }, { id: 'x2', type: 'out', amount: 'abc', title: 't' }); save(); go('finance'); });
  const t = (await A.textContent('#net')) + (await A.textContent('#income')); assert.ok(!/NaN/.test(t), t); await A.evaluate(() => { db.finance = db.finance.filter(x => !/^x[12]$/.test(x.id)); save(); });
});
await T('XSS: اسم يحتوي HTML لا يُنفَّذ في قائمة الحيوانات والمواعيد', async () => {
  await A.evaluate(() => { window.__x = 0; db.patients.push({ id: 'xs1', name: '<img src=x onerror=window.__x=1>', owner: '"><script>window.__x=2</script>', kind: 'كلب', phone: '', vaccines: [] }); db.appointments.push({ id: 'xs2', animal: '<b onmouseover=window.__x=3>x</b>', owner: '<svg onload=window.__x=4>', type: '<i>', date: '2026-11-01', notes: '<img src=y onerror=window.__x=5>' }); save(); go('patients'); go('appointments'); patientSheet('xs1'); });
  await A.waitForTimeout(300); assert.equal(await A.evaluate(() => window.__x), 0); assert.equal(await A.locator('#patientsList img[src="x"]').count(), 0);
  await A.evaluate(() => { closeSheet(); db.patients = db.patients.filter(x => x.id !== 'xs1'); db.appointments = db.appointments.filter(x => x.id !== 'xs2'); save(); });
});
await T('XSS: صورة ببيانات خبيثة لا تكسر الوسم', async () => {
  await A.evaluate(() => { window.__x = 0; db.patients.push({ id: 'xs3', name: 'ص', owner: 'م', kind: 'كلب', photo: 'x" onerror="window.__x=9', vaccines: [] }); save(); go('patients'); patientSheet('xs3'); });
  await A.waitForTimeout(300); assert.equal(await A.evaluate(() => window.__x), 0); await A.evaluate(() => { closeSheet(); db.patients = db.patients.filter(x => x.id !== 'xs3'); save(); });
});
await T('إضافة تطعيم وربطه بالحيوان الصحيح', async () => {
  const r = await A.evaluate(() => { const p = db.patients[0]; p.vaccines.push({ id: 'v1', vid: 'rabies', label: 'تحصين السعار', date: '2026-10-01', nextDate: '2027-10-01', notes: '' }); save(); return db.patients.map(x => [x.name, x.vaccines.length]); });
  assert.deepEqual(r, [['ريكس', 1]]);
});
await T('إدارة الحجوزات/المشتريات/الديون: إضافة وحذف بدون أخطاء', async () => {
  await A.evaluate(() => { db.shortages.push({ id: uid(), name: 'حقن', qty: '3', date: dateNow() }); db.companies.push({ id: uid(), name: 'شركة', phone: '01011112222' }); db.debts.push({ id: uid(), party: 'أ', dir: 'in', total: '100', paid: '', date: dateNow() }); db.orders.push({ id: uid(), company: 'شركة', date: dateNow(), products: 'أ\nب', total: '', paid: '' }); db.chicks.push({ id: uid(), name: 'ع', phone: '01011112222', counts: { 'أبيض': 5 }, date: dateNow() }); save(); go('buy'); go('chicks'); });
  await A.waitForTimeout(200); assert.equal(JSON.stringify(A.errs), '[]');
});
await T('سجل بصورة كبيرة محليًا يعمل ويعرض', async () => {
  await A.evaluate(() => { db.patients[0].photo = 'data:image/jpeg;base64,' + 'A'.repeat(300000); save(); go('patients'); }); await A.waitForTimeout(200); assert.equal(JSON.stringify(A.errs), '[]'); await A.evaluate(() => { db.patients[0].photo = ''; save(); });
});
await T('نسخة احتياطية: تصدير ثم استيراد (دمج) ثم رفض ملف تالف بدون تغيير', async () => {
  await A.evaluate(() => go('settings'));
  const [dl] = await Promise.all([A.waitForEvent('download'), A.click('#settings button:has-text("تصدير نسخة احتياطية")')]); const file = '/tmp/bk.json'; await dl.saveAs(file);
  const before = await A.evaluate(() => localStorage.getItem('maraei_v2'));
  fs.writeFileSync('/tmp/bad.json', '{"patients":[1],"appointments":[],"finance":[]}'); A.once('dialog', d => d.accept());
  await A.setInputFiles('#backupFile', '/tmp/bad.json'); await A.click('text=فحص واستعادة النسخة'); await A.waitForTimeout(300);
  assert.equal(await A.evaluate(() => localStorage.getItem('maraei_v2')), before);
  fs.writeFileSync('/tmp/junk.json', 'not json'); await A.setInputFiles('#backupFile', '/tmp/junk.json'); await A.click('text=فحص واستعادة النسخة'); await A.waitForTimeout(300); assert.equal(await A.evaluate(() => localStorage.getItem('maraei_v2')), before);
  await A.evaluate(() => { db.patients.length = 0; save(); }); await A.setInputFiles('#backupFile', file); await A.click('text=فحص واستعادة النسخة'); await A.waitForSelector('#sheet button:text-is("تنفيذ")'); await A.click('#sheet button:text-is("تنفيذ")'); await A.waitForTimeout(300);
  assert.equal(await A.evaluate(() => db.patients.length), 1); assert.ok(await A.evaluate(() => localStorage.getItem('maraei_pre1')), 'pre-backup'); assert.match(await A.textContent('#lastBackup'), /آخر نسخة/);
});
// ===== 3) المزامنة والمصادقة =====
await T('بدون حساب الدكتور في admins لا تتم المزامنة ولا يُعرض بيانات', async () => {
  srv.users.set('stranger@test.local', { pw: 'x1234567', uid: 'STR' });
  const c = await newCtx(); const P = await open(c, 'index.html'); await P.evaluate(() => go('requests')); await P.fill('#lgEmail', 'stranger@test.local'); await P.fill('#lgPass', 'x1234567'); await P.click('#loginForm button'); await P.waitForTimeout(800);
  assert.match(await P.textContent('#cloudMsg'), /غير مُعرَّف/); assert.equal(docsOf('patients').length, 0); await c.close();
});
await T('تسجيل دخول الدكتور يرحّل ويرفع السجلات كمستندات منفصلة', async () => {
  await login(A); assert.ok(await waitFor(() => docsOf('patients').length === 1 && docsOf('finance').length === 2 && docsOf('appointments').length === 1), 'docs: ' + [...srv.docs.keys()].join() + ' ENG ' + await A.evaluate(() => JSON.stringify({ s: window.__sync.engine.status(), ob: window.__sync.engine.st.outbox, e: window.__sync.engine.errState })));
  const f = srv.docs.get(docsOf('finance')[0]); assert.equal(f.rev, 1); assert.ok(f.updatedAt > 0);
});
await T('جهاز ثانٍ يستقبل البيانات، والتعديلات تتزامن بالاتجاهين', async () => {
  const c2 = await newCtx(); const B = await open(c2, 'index.html'); await login(B);
  assert.ok(await waitFor(async () => (await B.evaluate(() => db.patients.length)) === 1), 'B patients');
  await B.evaluate(() => { db.patients[0].phone = '01099999999'; save(); });
  assert.ok(await waitFor(async () => (await A.evaluate(() => db.patients[0].phone)) === '01099999999', 8000), 'A got B edit');
  await A.evaluate(() => { db.finance.push({ id: 'fin-A', type: 'in', amount: '10', title: 'a', date: '2026-10-27' }); save(); });
  assert.ok(await waitFor(async () => (await B.evaluate(() => db.finance.length)) === 3, 8000), 'B got finance');
  const inc = await B.evaluate(() => db.finance.filter(x => x.type === 'in').reduce((s, x) => s + N(x.amount), 0)); assert.equal(inc, 130.5);
  globalThis.__B = B; globalThis.__c2 = c2;
});
await T('تعارض تعديلين من جهازين أوفلاين ثم اتصال: لا فقد ولا تكرار', async () => {
  const B = globalThis.__B; srv.down = true;
  await A.evaluate(() => { db.patients[0].name = 'اسم من A'; save(); }); await B.evaluate(() => { db.patients[0].age = '٣ سنوات'; db.finance.push({ id: 'fin-B', type: 'out', amount: '5', title: 'b', date: '2026-10-27' }); save(); });
  await A.waitForTimeout(1200); assert.match(await A.textContent('#syncPill'), /معلق|اتصال/); // معلقة وليست «تمت المزامنة»
  assert.ok(await A.evaluate(() => JSON.parse(localStorage.getItem('maraei_v2')).patients[0].name) === 'اسم من A', 'local kept');
  srv.down = false;
  assert.ok(await waitFor(async () => { const a = await A.evaluate(() => [db.patients[0].name, db.patients[0].age, db.finance.length]); const b = await B.evaluate(() => [db.patients[0].name, db.patients[0].age, db.finance.length]); return JSON.stringify(a) === JSON.stringify(b) && a[0] === 'اسم من A' && a[1] === '٣ سنوات' && a[2] === 4; }, 15000), 'converge');
  assert.equal(docsOf('finance').length, 4);
});
await T('حذف سجل يختفي من الجهاز الآخر ويبقى tombstone بدون بيانات', async () => {
  const B = globalThis.__B; await A.evaluate(() => { db.finance = db.finance.filter(x => x.id !== 'fin-A'); save(); });
  assert.ok(await waitFor(async () => (await B.evaluate(() => db.finance.length)) === 3, 8000)); const t = srv.docs.get('finance/fin-A'); assert.equal(t._deleted, true); assert.equal(t.title, undefined);
});
await T('صورة كبيرة تُرفع في مستند images والسجل صغير، وتظهر على الجهاز الآخر', async () => {
  const B = globalThis.__B; const big = 'data:image/jpeg;base64,' + 'QUJD'.repeat(70000);
  await A.evaluate(b => { db.patients[0].photo = b; save(); }, big);
  assert.ok(await waitFor(async () => (await B.evaluate(() => db.patients[0].photo.length)) === big.length, 10000), 'photo on B');
  assert.ok(JSON.stringify(srv.docs.get(docsOf('patients')[0])).length < 3000); assert.ok(docsOf('images').length >= 1);
});
await T('فشل الصلاحيات يظهر حالة خطأ واضحة ولا يمسح النسخة المحلية', async () => {
  const c = await newCtx(); const B = await open(c, 'index.html'); await login(B, 'doctor2@test.local'); srv.docs.delete('admins/DOC2'); await B.evaluate(() => { db.debts.push({ id: 'dd-1', party: 'ز', dir: 'in', total: '9', paid: '' }); save(); });
  assert.ok(await waitFor(async () => /تعذر|معلق/.test(await B.textContent('#syncPill')), 8000), await B.textContent('#syncPill')); assert.equal(await B.evaluate(() => db.debts.some(d => d.id === 'dd-1')), true); assert.ok(!docsOf('debts').some(k => k.endsWith('dd-1'))); srv.docs.set('admins/DOC2', { ok: true });
  await B.evaluate(() => window.__sync.engine.retry()); assert.ok(await waitFor(() => docsOf('debts').some(k => k.endsWith('dd-1')), 8000), 'retry pushed'); await c.close();
});
await T('ترحيل من المستند القديم clinic/data بدون فقد', async () => {
  const c = await newCtx(); srv.docs.set('clinic/data', { json: JSON.stringify({ patients: [{ id: 'old-1', name: 'قديم', owner: 'م', kind: 'قط', vaccines: [] }], appointments: [], finance: [{ id: 'old-f', type: 'in', amount: '50' }], requests: [] }), by: 'x', at: 1 });
  const P = await open(c, 'index.html'); P.on('dialog', d => d.accept()); await P.evaluate(() => { localStorage.setItem('maraei_v2', JSON.stringify({ patients: [{ id: 'loc-1', name: 'محلي', owner: 'م', kind: 'كلب', vaccines: [] }], appointments: [], finance: [], requests: [], settings: {} })); }); await P.reload(); await P.waitForTimeout(300);
  await login(P); const names = await P.evaluate(() => db.patients.map(p => p.name).sort()); assert.ok(names.includes('قديم') && names.includes('محلي'), names.join());
  assert.ok(srv.docs.has('meta/migration')); assert.ok(await P.evaluate(() => localStorage.getItem('maraei_pre1'))); assert.ok(srv.docs.has('clinic/data'), 'legacy kept'); await c.close();
});
// ===== 4) صفحة العملاء =====
const ctxC1 = await newCtx(), ctxC2 = await newCtx();
const C1 = await open(ctxC1, 'customer.html'), C2 = await open(ctxC2, 'customer.html');
const fill = async (P, name, extra = {}) => { await P.fill('[name=name]', name); await P.fill('#ph', '01012345678'); await P.fill('[name=details]', extra.details || 'كحة وفقدان شهية'); };
await T('صفحة العميل على 360px بدون أخطاء ولا تمدد أفقي', async () => { assert.deepEqual(C1.errs, []); assert.ok((await C1.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1); });
await T('إرسال طلب: يظهر في لوحة الدكتور بحالة جديد ومنسوب لصاحبه', async () => {
  await fill(C1, 'عميل أول'); await C1.click('#booking button'); await C1.waitForSelector('#success:has-text("تم إرسال")'); const ids = docsOf('requests'); assert.equal(ids.length, 1); const r = srv.docs.get(ids[0]); assert.equal(r.status, 'جديد'); assert.ok(r.ownerUid.startsWith('anon-'));
  await A.evaluate(() => go('requests')); assert.ok(await waitFor(async () => (await A.textContent('#cloudList')).includes('عميل أول'), 6000));
});
await T('الضغط المتكرر لا يكرر الطلب', async () => {
  await fill(C1, 'عميل ضغط'); await C1.evaluate(() => { const f = document.getElementById('booking'); f.requestSubmit(); f.requestSubmit(); f.requestSubmit(); }); await C1.waitForSelector('#success:has-text("تم إرسال")'); await C1.waitForTimeout(500); assert.equal(docsOf('requests').length, 2);
});
await T('انقطاع الإنترنت: الرسالة واضحة والنموذج يحتفظ بالبيانات ثم الإعادة لا تكرر', async () => {
  await fill(C1, 'عميل أوفلاين'); srv.down = true; await C1.click('#booking button'); await C1.waitForSelector('#success:has-text("لا يوجد اتصال"), #success:has-text("تعذر")'); assert.equal(await C1.inputValue('[name=name]'), 'عميل أوفلاين'); srv.down = false;
  await C1.click('#booking button'); await C1.waitForSelector('#success:has-text("تم إرسال")'); assert.equal(docsOf('requests').length, 3);
});
await T('الدكتور يغيّر الحالة ويرد، والرد يظهر لصاحب الطلب فقط', async () => {
  await A.evaluate(() => go('requests')); await A.waitForTimeout(500);
  await A.locator('#cloudList article', { hasText: 'عميل أول' }).locator('[data-act=reply]').click(); await A.fill('#rpTxt', 'تم تأكيد حجزك'); await A.click('#rpForm button:text-is("إرسال الرد")');
  assert.ok(await waitFor(async () => (await C1.textContent('#mineList')).includes('تم تأكيد حجزك'), 6000), 'C1 sees reply :: ' + JSON.stringify([...srv.docs].filter(([k]) => k.startsWith('requests/')).map(([k, v]) => [v.name, v.reply, v.status])) + ' C1: ' + await C1.textContent('#mineList') + ' errs ' + JSON.stringify(C1.errs)); assert.ok((await C1.textContent('#mineList')).includes('تم الرد'));
  await C2.reload(); await C2.waitForTimeout(800); assert.ok(!(await C2.textContent('#mineList')).includes('تم تأكيد حجزك')); assert.equal(await C2.evaluate(() => document.getElementById('mine').style.display), 'none');
});
await T('العميل لا يستطيع قراءة طلب غيره أو تعديل الحالة/الرد أو القراءة الشاملة (محاكاة القواعد)', async () => {
  const id = docsOf('requests')[0].split('/')[1];
  const r = await C2.evaluate(async id => { const out = {}; const st = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'); const db = st.getFirestore(); const t = async (k, f) => { try { await f(); out[k] = 'allowed'; } catch (e) { out[k] = e.code; } };
    await t('get', () => st.getDoc(st.doc(db, 'requests', id))); await t('listAll', () => new Promise((res, rej) => { const u = st.onSnapshot(st.collection(db, 'requests'), () => { u(); res(); }, rej); }));
    await t('update', () => st.updateDoc(st.doc(db, 'requests', id), { status: 'تم الرد', reply: 'x' })); await t('patients', () => st.getDoc(st.doc(db, 'patients', 'p'))); await t('settings', () => st.setDoc(st.doc(db, 'public', 'page'), { title: 'hack' })); return out; }, id);
  assert.deepEqual(r, { get: 'permission-denied', listAll: 'permission-denied', update: 'permission-denied', patients: 'permission-denied', settings: 'permission-denied' });
});
await T('إنشاء طلب بحقول إدارة (status/reply) أو ownerUid لشخص آخر يُرفض', async () => {
  const r = await C2.evaluate(async () => { const st = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'); const db = st.getFirestore(), out = {}; const base = { name: 'xx', phone: '01012345678', type: 'استفسار', details: 'd', status: 'جديد', createdAt: st.serverTimestamp(), ownerUid: JSON.parse(sessionStorage.getItem('fakeuser')).uid };
    const t = async (k, d) => { try { await st.setDoc(st.doc(db, 'requests', 'z-' + k), d); out[k] = 'allowed'; } catch (e) { out[k] = e.code; } };
    await t('ok', base); await t('status', { ...base, status: 'تم الرد' }); await t('reply', { ...base, reply: 'x' }); await t('other', { ...base, ownerUid: 'someone' }); await t('phone', { ...base, phone: '123' }); return out; });
  assert.deepEqual(r, { ok: 'allowed', status: 'permission-denied', reply: 'permission-denied', other: 'permission-denied', phone: 'permission-denied' }); srv.docs.delete('requests/z-ok');
});
await T('XSS في صفحة العميل: نص خبيث في الرد/النوع لا يُنفَّذ', async () => {
  const id = docsOf('requests')[0].split('/')[1]; srv.docs.get('requests/' + id).reply = '<img src=x onerror=window.__cx=1>'; await C1.evaluate(() => { window.__cx = 0; }); await C1.waitForTimeout(600); assert.equal(await C1.evaluate(() => window.__cx), 0); assert.equal(await C1.locator('#mineList img').count(), 0);
});
await T('صفحة العملاء العامة: الدكتور يحفظ نصًا وصورًا، والعميل يراها (صور من publicImages)', async () => {
  await A.evaluate(() => go('settings')); const img = 'data:image/jpeg;base64,/9j/4AAQ' + 'QUJD'.repeat(50);
  await A.evaluate(async i => { pgImages = [i]; $('pgTitle').value = 'عنوان جديد'; await savePage(); }, img);
  assert.ok(await waitFor(() => !!srv.docs.get('public/page') && srv.docs.get('public/page').imageIds && srv.docs.get('public/page').imageIds.length === 1), 'public page saved'); assert.ok(docsOf('publicImages').length === 1);
  await C2.reload(); await C2.waitForTimeout(900); assert.equal(await C2.textContent('#wT'), 'عنوان جديد'); assert.ok((await C2.locator('#gslides img').first().getAttribute('src')).startsWith('data:image/jpeg'));
});
await T('بيانات خبيثة في صفحة العميل العامة: رابط javascript: وصورة غير صالحة تُتجاهل', async () => {
  srv.docs.get('public/page').pageUrl = 'javascript:alert(1)'; srv.docs.get('public/page').imageIds = []; srv.docs.get('public/page').images = ['x" onerror="window.__gx=1']; await C2.addInitScript(() => { window.__gx = 0; }); await C2.reload(); await C2.waitForTimeout(900);
  assert.equal(await C2.evaluate(() => window.__gx), 0); assert.equal(await C2.evaluate(() => document.getElementById('wLink').style.display), 'none');
});
// ===== 5) PWA والـ Service Worker =====
await T('Service Worker يُسجَّل ويعمل أوفلاين للصفحات الأساسية', async () => {
  const c = await browser.newContext({ viewport: { width: 360, height: 640 } }); await c.exposeBinding('__fakeCall', async () => ({ err: 'unavailable' }));
  for (const m of ['app', 'auth', 'firestore']) await c.route(`https://www.gstatic.com/firebasejs/10.12.2/firebase-${m}.js`, r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(ROOT, 'tests/fake/firebase-' + m + '.js'), 'utf8') }));
  await c.addInitScript(() => { const raw = window.__fakeCall; window.__fakeCall = async (op, a) => { const r = await raw(op, a); if (r.err) throw Object.assign(new Error(r.err), { code: r.err }); return r.ok; }; });
  const p = await c.newPage(); await p.goto(BASE + '/index.html'); await p.evaluate(() => navigator.serviceWorker.ready); await p.waitForTimeout(800); await p.reload(); await p.waitForTimeout(500);
  const keys = await p.evaluate(async () => { const out = []; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname); return out; });
  for (const f of ['/index.html', '/customer.html', '/app-cloud.js', '/lib/sync-core.js', '/lib/backup.js']) assert.ok(keys.includes(f), 'cached ' + f + ' in ' + keys.join());
  await c.setOffline(true); await p.reload(); await p.waitForTimeout(600); assert.ok((await p.textContent('h1')).includes('المراعي')); const before = await p.evaluate(() => localStorage.getItem('maraei_v2'));
  await p.evaluate(() => { db.shortages.push({ id: 'off1', name: 'أوفلاين', qty: '1', date: dateNow() }); save(); }); assert.ok(await p.evaluate(() => JSON.parse(localStorage.getItem('maraei_v2')).shortages.some(s => s.id === 'off1')));
  await p.goto(BASE + '/customer.html'); assert.ok((await p.textContent('#wT')).includes('المراعي')); await c.close();
});
await T('manifest صالح وأيقونات موجودة', async () => { for (const f of ['manifest.json', 'manifest-customer.json']) { const m = JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')); assert.ok(m.name && m.start_url && m.icons.length); for (const i of m.icons) assert.ok(fs.existsSync(path.join(ROOT, i.src)), i.src); } });
// ===== 6) كل الأزرار الأساسية =====
await T('كل أزرار/عناصر onclick في التبويبات الرئيسية مرتبطة بدوال موجودة', async () => {
  const missing = await A.evaluate(() => { const bad = new Set(); document.querySelectorAll('[onclick]').forEach(e => { const m = e.getAttribute('onclick').match(/^\s*([A-Za-z_$][\w$]*)\s*\(/); if (m && !['if', 'event', 'confirm', 'alert', 'this'].includes(m[1]) && typeof window[m[1]] !== 'function') bad.add(m[1]); }); return [...bad]; });
  assert.equal(JSON.stringify(missing), '[]');
});
await browser.close(); server.close();
fs.writeFileSync(path.join(ROOT, 'tests/e2e-results.txt'), results.map(r => r.join('  ')).join('\n') + '\n');
console.log(`\n${results.length - failed}/${results.length} passed`); process.exit(failed ? 1 : 0);
