// لوحة الدكتور: المصادقة، المزامنة، النسخ الاحتياطي، طلبات العملاء، صفحة العملاء.
// ملاحظة: التطبيق المحلي (index.html) يعمل بدون هذا الملف؛ هذا الملف يضيف السحابة فوقه.
import { COLLS, SETTINGS_ID, META_COLL, SyncEngine, ID_RE, cyrb53 } from './lib/sync-core.js';
import { validateBackup, makeBackup, applyImport, diffSummary, migrateLegacy } from './lib/backup.js';
import { firebaseConfig } from './firebase-config.js';

const A = window.__app, $ = id => document.getElementById(id), E = A.esc;
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'i' + Math.random().toString(36).slice(2) + Date.now().toString(36));
const RN = c => (c === 'requests' ? 'manualRequests' : c);      // اسم المجموعة البعيدة
const LN = c => (c === 'manualRequests' ? 'requests' : c);
const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* المساحة ممتلئة */ } } };
let F = null, fs = null, auth = null, isDoctor = false, signedUser = null, unsubs = [], q = Promise.resolve(), putImgs = new Set();

// ---------------- المحرك ----------------
const lazyBackend = {
  async runTxn(c, id, fn) { need(); return F.runTransaction(fs, async tx => { const r = F.doc(fs, RN(c), id), s = await tx.get(r); const { write, result } = fn(s.exists() ? s.data() : null); if (write) tx.set(r, write); return result; }); },
  async getImage(id) { need(); const s = await F.getDoc(F.doc(fs, 'images', id)); return s.exists() ? s.data().data : null; },
  async putImage(id, data) { need(); if (putImgs.has(id)) return; const r = F.doc(fs, 'images', id); const s = await F.getDoc(r); if (!s.exists()) await F.setDoc(r, { data, updatedAt: Date.now() }); putImgs.add(id); }
};
function need() { if (!F || !isDoctor) throw Object.assign(new Error('offline'), { code: 'unavailable' }); }
const eng = new SyncEngine({ getDb: () => A.db, store, backend: lazyBackend, onStatus: paint, onChange: () => { A.persist(); A.render(); }, isOnline: () => navigator.onLine });
window.__sync = { localChanged: () => eng.localChanged(), engine: eng };
eng.scan(); // يلتقط أي فروق محلية من الجلسات السابقة

function fmtT(t) { return t ? new Date(t).toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' }) : ''; }
function paint(s) {
  const e = $('syncPill'); if (!e) return; let t, c = 'warn';
  if (!signedUser || !isDoctor) { t = '☁ غير متزامن — سجّل دخول من تبويب العملاء' + (s.pending ? ' · تعديلات محلية: ' + s.pending : ''); }
  else if (s.state === 'error') t = '⚠ تعذر الحفظ' + (s.pending ? ' · معلق: ' + s.pending : '');
  else if (s.state === 'syncing') t = '🔄 جارٍ الحفظ…';
  else if (s.state === 'offline') t = '📴 لا يوجد اتصال' + (s.pending ? ' · تعديلات معلقة: ' + s.pending : ' — الحفظ على الجهاز فقط');
  else if (s.state === 'pending') t = '⏳ توجد تعديلات معلقة: ' + s.pending;
  else { t = '☁ تمت المزامنة ' + fmtT(s.at); c = 'ok'; }
  e.textContent = t; e.className = 'pill ' + c; e.style.cursor = 'pointer'; e.onclick = showSyncInfo;
  const d = $('syncDetail'); if (d) d.textContent = t + (eng.st.conflicts.length ? ' · تعارضات مسجلة: ' + eng.st.conflicts.length : '');
}
window.showSyncInfo = showSyncInfo;
function showSyncInfo() {
  const s = eng.status(), cf = eng.st.conflicts.length;
  A.openSheet(`<h3>حالة المزامنة</h3><p>${E(s.text)}${s.error ? '<br><b>' + E(s.error) + '</b>' : ''}</p><p class="muted">تعديلات معلقة: ${s.pending} · آخر مزامنة ناجحة: ${eng.st.lastSyncAt ? E(new Date(eng.st.lastSyncAt).toLocaleString('ar-EG')) : 'لم تتم'}<br>العمل المحلي يستمر بدون إنترنت، لكن المزامنة مع السحابة تحتاج اتصالًا وتسجيل دخول.</p>
  ${cf ? `<p class="muted">يوجد ${cf} تعارض تم حله تلقائيًا (الأحدث كسب) وتم حفظ القيمة الأخرى في سجل التعارضات.</p><button class="btn alt sm" onclick="exportConflicts()">تصدير سجل التعارضات</button> ` : ''}
  <button class="btn sm" onclick="syncRetry()">إعادة المحاولة الآن</button> <button class="btn alt sm" onclick="closeSheet()">إغلاق</button>`);
}
window.syncRetry = () => { eng.retry(); A.closeSheet(); };
window.exportConflicts = () => saveFile('maraei-conflicts-' + A.dateNow() + '.json', JSON.stringify(eng.st.conflicts, null, 2));

// ---------------- حفظ الملفات (يدعم APK) ----------------
function saveFile(name, text) {
  try { if (window.AndroidFiles && window.AndroidFiles.save) { window.AndroidFiles.save(name, text); return true; } } catch (e) {}
  const a = document.createElement('a'), u = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); return true;
}

// ---------------- النسخ الاحتياطي ----------------
const LB = 'maraei_last_backup';
function showLB() { const e = $('lastBackup'); if (!e) return; const t = store.get(LB); e.textContent = t ? 'آخر نسخة احتياطية: ' + new Date(t).toLocaleString('ar-EG') : 'لم يتم تصدير نسخة احتياطية بعد'; }
window.exportBackup = () => { const b = makeBackup(A.db, { app: 'maraei-vet' }); saveFile('maraei-backup-' + A.dateNow() + '.json', JSON.stringify(b)); store.set(LB, new Date().toISOString()); showLB(); A.toast('✔ تم تجهيز النسخة الاحتياطية'); };
function savePre(label) { // نسخة تلقائية قبل أي استعادة/ترحيل (آخر نسختين)
  const b = makeBackup(A.db, { reason: label }); const s = JSON.stringify(b);
  try { const k2 = store.get('maraei_pre1'); if (k2) localStorage.setItem('maraei_pre2', k2); localStorage.setItem('maraei_pre1', s); return true; } catch (e) { return false; }
}
window.importBackup = async () => {
  const f = $('backupFile').files[0]; if (!f) return alert('اختر ملف النسخة أولًا');
  let raw; try { raw = JSON.parse(await f.text()); } catch (e) { return alert('الملف تالف أو ليس JSON صالحًا. لم يتم تغيير أي بيانات.'); }
  const v = validateBackup(raw);
  if (!v.ok) return alert('تم رفض الملف ولم يتغير شيء من بياناتك:\n- ' + v.errors.join('\n- '));
  window.__pendingImport = v.db; const s = diffSummary(A.db, v.db);
  A.openSheet(`<h3>استعادة نسخة احتياطية</h3><p>النسخة سليمة. مقارنة مع البيانات الحالية:<br>سجلات جديدة: <b>${s.add}</b> · سجلات مختلفة: <b>${s.change}</b> · متطابقة: ${s.same} · موجودة عندك فقط: <b>${s.onlyLocal}</b></p>
  <label style="display:block;margin:8px 0"><input type="radio" name="impMode" value="merge" checked> دمج (إضافة وتحديث بالمعرّف — لا يحذف أي شيء) <b>— موصى به</b></label>
  <label style="display:block;margin:8px 0"><input type="radio" name="impMode" value="replace"> استبدال كامل (يحذف الموجود عندك فقط، وسيتم حذفه من السحابة أيضًا بعد المزامنة)</label>
  <div class="field"><input id="impConfirm" placeholder="للاستبدال الكامل اكتب: استبدال"></div>
  <p class="muted">سيتم حفظ نسخة تلقائية من بياناتك الحالية قبل التنفيذ، ويمكنك التراجع من الإعدادات.</p>
  <button class="btn" onclick="doImport()">تنفيذ</button> <button class="btn alt" onclick="closeSheet()">إلغاء</button>`);
};
window.doImport = () => {
  const mode = (document.querySelector('input[name=impMode]:checked') || {}).value || 'merge', inc = window.__pendingImport; if (!inc) return;
  if (mode === 'replace' && $('impConfirm').value.trim() !== 'استبدال') return alert('اكتب كلمة «استبدال» للتأكيد، أو اختر الدمج.');
  if (!savePre('before-import')) { window.exportBackup(); }
  A.db = applyImport(A.db, inc, mode, uuid); A.persist(); A.render(); eng.localChanged(); window.__pendingImport = null; A.closeSheet(); A.toast('✔ تمت الاستعادة (' + (mode === 'merge' ? 'دمج' : 'استبدال') + ')');
};
window.undoImport = () => {
  const s = store.get('maraei_pre1'); if (!s) return alert('لا توجد نسخة تلقائية للتراجع إليها.');
  let raw; try { raw = JSON.parse(s); } catch (e) { return alert('النسخة التلقائية تالفة.'); }
  const v = validateBackup(raw); if (!v.ok) return alert('النسخة التلقائية غير صالحة.');
  if (!confirm('التراجع إلى حالة البيانات قبل آخر استعادة/ترحيل؟ سيحل محل البيانات الحالية.')) return;
  A.db = applyImport(A.db, v.db, 'replace', uuid); A.persist(); A.render(); eng.localChanged(); A.toast('✔ تم التراجع');
};
showLB();

// ---------------- Firebase ----------------
async function loadFirebase() {
  const [app, au, st] = await Promise.all([import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js')]);
  const a = app.initializeApp(firebaseConfig); auth = au.getAuth(a); fs = st.getFirestore(a, firebaseConfig.databaseId);
  F = { ...st, signIn: au.signInWithEmailAndPassword, signOut: au.signOut, onAuth: au.onAuthStateChanged };
}
const msg = t => { const e = $('cloudMsg'); if (e) e.textContent = t; };
function teardown() { unsubs.forEach(u => { try { u(); } catch (e) {} }); unsubs = []; eng.stop(); }

async function boot() {
  if (!firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith('PASTE')) { msg('لم يتم ربط Firebase بعد (املأ ملف firebase-config.js).'); return; }
  try { await loadFirebase(); } catch (e) {
    msg('تعذر تحميل مكتبات Firebase (لا يوجد اتصال بالإنترنت). التطبيق يعمل محليًا وتعديلاتك محفوظة على الجهاز وستُرفع عند عودة الاتصال.');
    paint(eng.status()); window.addEventListener('online', () => location.reload(), { once: true }); return;
  }
  $('loginForm').addEventListener('submit', async e => { e.preventDefault(); msg('جاري الدخول...'); try { await F.signIn(auth, $('lgEmail').value.trim(), $('lgPass').value); $('lgPass').value = ''; } catch (x) { msg(navigator.onLine ? 'الإيميل أو كلمة السر غير صحيحة' : 'لا يوجد اتصال بالإنترنت'); } });
  $('logoutBtn').onclick = () => F.signOut(auth);
  window.addEventListener('online', () => { eng.paused = false; eng.emit(); eng.kick(300); }); window.addEventListener('offline', () => eng.emit());
  F.onAuth(auth, onUser);
}

async function onUser(u) {
  teardown(); isDoctor = false; signedUser = u; window.cloudN = 0; window.cloudDocs = {};
  $('loginForm').classList.toggle('hidden', !!u); $('logoutBtn').classList.toggle('hidden', !u);
  if (!u) { msg('سجّل الدخول لعرض طلبات العملاء ومزامنة البيانات.'); $('cloudList').innerHTML = ''; paint(eng.status()); A.render(); return; }
  try { const s = await F.getDoc(F.doc(fs, 'admins', u.uid)); isDoctor = s.exists() && !u.isAnonymous; } catch (e) { isDoctor = false; }
  if (!isDoctor) { msg('هذا الحساب غير مُعرَّف كحساب الدكتور في Firebase. المعرّف (UID): ' + u.uid + ' — أضفه كمستند في المجموعة admins من لوحة Firebase.'); paint(eng.status()); return; }
  msg(''); paint(eng.status());
  if (!(await maybeMigrate())) { msg('تم إيقاف المزامنة لحين إتمام الترحيل. بياناتك المحلية سليمة.'); return; }
  startSync(); startRequests(); loadPublic();
}

// ----- ترحيل من التصميم القديم (clinic/data) -----
async function maybeMigrate() {
  try {
    const mk = await F.getDoc(F.doc(fs, 'meta', 'migration')); if (mk.exists()) return true;
    const lg = await F.getDoc(F.doc(fs, 'clinic', 'data')); if (!lg.exists()) return true;
    let legacy; try { legacy = JSON.parse(lg.data().json); } catch (e) { return confirm('مستند السحابة القديم تالف ولا يمكن ترحيله. المتابعة بالبيانات المحلية فقط؟'); }
    const v = validateBackup(legacy); if (!v.ok) return confirm('مستند السحابة القديم غير صالح (' + v.errors[0] + '). المتابعة بالبيانات المحلية فقط؟');
    const dirty = store.get('maraei_dirty') === '1', { db, stats } = migrateLegacy(A.db, v.db, { localDirty: dirty });
    const ok = confirm('ترحيل البيانات للتصميم الجديد (مرة واحدة):\n\n• سجلات من السحابة القديمة ستُضاف: ' + stats.fromLegacy + '\n• سجلات متعارضة: ' + stats.conflicts + (dirty ? ' (ستُحفظ نسخة هذا الجهاز لأن فيه تعديلات غير مرفوعة)' : ' (ستُستخدم نسخة السحابة)') + '\n\nسيتم حفظ نسخة احتياطية تلقائية على الجهاز أولًا، ولن يُحذف المستند القديم من السحابة.\n\nموافق؟');
    if (!ok) return false;
    if (!savePre('before-migration')) window.exportBackup();
    A.db = db; A.persist(); A.render(); eng.scan();
    await F.setDoc(F.doc(fs, 'meta', 'migration'), { id: 'migration', rev: 1, updatedAt: Date.now(), from: 'clinic/data', stats });
    return true;
  } catch (e) { msg('تعذر فحص الترحيل: ' + (e && e.code || 'خطأ') + ' — راجع قواعد Firestore.'); return false; }
}

function startSync() {
  const total = COLLS.length + 1; let got = 0, started = false;
  const go = () => { if (started) return; started = true; eng.start(); };
  const first = () => { if (++got >= total) go(); };
  setTimeout(go, 8000);
  const sub = (ref, cb) => { let f = false; unsubs.push(F.onSnapshot(ref, sn => { cb(sn); if (!f) { f = true; first(); } }, err => { if (!f) { f = true; first(); } if (err && err.code === 'permission-denied') { eng.errState = 'الصلاحيات ترفض القراءة — راجع قواعد Firestore وحساب الدكتور'; eng.paused = true; eng.emit(); } })); };
  for (const c of COLLS) sub(F.collection(fs, RN(c)), sn => sn.docChanges().forEach(ch => { const d = ch.doc.data(); q = q.then(() => eng.onRemote(c, ch.doc.id, ch.type === 'removed' ? null : d)).catch(() => {}); }));
  sub(F.doc(fs, META_COLL, SETTINGS_ID), sn => { if (sn.exists()) q = q.then(() => eng.onRemote(META_COLL, SETTINGS_ID, sn.data())).catch(() => {}); });
}

// ----- طلبات العملاء (لوحة الدكتور) -----
const QR = ['تم تأكيد حجزك، في انتظارك إن شاء الله.', 'برجاء الاتصال بالعيادة لتحديد الموعد المناسب.', 'تم استلام استفسارك وسنوافيك بالرد قريبًا.'];
const STATUSES = ['جديد', 'تم التواصل', 'تم التأكيد', 'تم الرد'];
function startRequests() {
  const qy = F.query(F.collection(fs, 'requests'), F.orderBy('createdAt', 'desc'));
  unsubs.push(F.onSnapshot(qy, snap => {
    window.cloudN = snap.size; window.cloudDocs = Object.fromEntries(snap.docs.map(d => [d.id, d.data()]));
    $('cloudList').innerHTML = snap.size ? snap.docs.map(d => reqCard(d.id, d.data())).join('') : '<div class="empty">لا توجد طلبات جديدة.</div>';
    $('nRequests').textContent = (A.db.requests || []).length + snap.size;
  }, () => msg('تعذر قراءة الطلبات: تأكد من قواعد Firestore ومن تسجيل دخول حساب الدكتور.')));
}
function reqCard(id, x) {
  const t = x.createdAt && x.createdAt.toDate ? x.createdAt.toDate().toLocaleString('ar-EG') : '', ph = /^01[0125]\d{8}$/.test(x.phone || '') ? x.phone : '';
  return `<article class="item" data-rid="${E(id)}"><div class="itemtop"><div><h3>${E(x.name)}</h3><p>${E(x.type)} · ${E(x.animalType)}${x.animalName ? ' (' + E(x.animalName) + ')' : ''}</p></div><span class="pill">${E(x.status)}</span></div><p>${E(x.details)}</p>${x.reply ? `<p style="background:#eaf7ef;border-radius:10px;padding:7px 9px"><b>ردك:</b> ${E(x.reply)}</p>` : ''}<p>${x.date ? 'التاريخ المفضل: ' + E(x.date) + ' ' + E(x.time || '') : ''}${x.address ? ' · العنوان: ' + E(x.address) : ''}</p><p>${E(t)}</p><div class="actions"><button class="btn sm" data-act="reply">${x.reply ? 'تعديل الرد' : 'رد'}</button>${ph ? `<a class="btn alt sm" style="text-decoration:none" href="tel:${ph}">اتصال ${ph}</a>` : ''}<button class="btn alt sm" data-act="st" data-v="تم التواصل">تم التواصل</button><button class="btn alt sm" data-act="st" data-v="تم التأكيد">تأكيد</button><button class="btn alt sm" data-act="del">حذف</button></div></article>`;
}
document.addEventListener('click', async e => {
  const b = e.target.closest && e.target.closest('#cloudList [data-act]'); if (!b) return; const id = b.closest('[data-rid]').dataset.rid, act = b.dataset.act;
  try {
    if (act === 'st' && STATUSES.includes(b.dataset.v)) await F.updateDoc(F.doc(fs, 'requests', id), { status: b.dataset.v });
    else if (act === 'del') { if (confirm('حذف الطلب؟')) await F.deleteDoc(F.doc(fs, 'requests', id)); }
    else if (act === 'reply') replySheet(id);
  } catch (x) { alert('تعذر تنفيذ العملية: ' + (x && x.code === 'permission-denied' ? 'الصلاحيات ترفض (راجع قواعد Firestore)' : (navigator.onLine ? 'خطأ' : 'لا يوجد اتصال'))); }
});
function replySheet(id) {
  const x = window.cloudDocs[id] || {};
  A.openSheet(`<h3>الرد على ${E(x.name)}</h3><p class="muted">${E(x.type)}${x.details ? ' — ' + E(x.details) : ''}</p><form id="rpForm" data-id="${E(id)}"><div class="field"><textarea name="reply" id="rpTxt" maxlength="1500" style="min-height:110px" placeholder="اكتب ردك للعميل">${E(x.reply || '')}</textarea></div><div class="chips" style="margin:0 0 8px">${QR.map(t => `<button type="button" class="chip" data-t="${E(t)}">${E(t)}</button>`).join('')}</div><button class="btn">إرسال الرد</button> <button class="btn alt" type="button" id="rpCancel">إلغاء</button></form>`);
  $('rpCancel').onclick = A.closeSheet; document.querySelectorAll('#rpForm .chip').forEach(c => c.onclick = () => { $('rpTxt').value = c.dataset.t; });
  $('rpForm').onsubmit = async ev => { ev.preventDefault(); const r = String(new FormData(ev.target).get('reply') || '').trim().slice(0, 1500), o = { reply: r, repliedAt: Date.now() }; o.status = r ? 'تم الرد' : (x.status || 'جديد'); try { await F.updateDoc(F.doc(fs, 'requests', id), o); A.closeSheet(); } catch (er) { alert('تعذر إرسال الرد، تأكد من الاتصال وقواعد Firestore'); } };
}

// ----- صفحة العملاء العامة -----
async function loadPublic() {
  try {
    const s = await F.getDoc(F.doc(fs, 'public', 'page')), d = s.exists() ? s.data() : {}; let imgs = [];
    if (Array.isArray(d.imageIds) && d.imageIds.length) { for (const id of d.imageIds) { if (!ID_RE.test(id)) continue; const im = await F.getDoc(F.doc(fs, 'publicImages', id)); if (im.exists()) imgs.push(im.data().data); } }
    else imgs = Array.isArray(d.images) ? d.images : (d.logo ? [d.logo] : []);
    window.pubData = { ...d, images: imgs }; A.fillPage();
  } catch (e) {}
}
window.pubSave = async o => {
  if (!isDoctor) throw new Error('not-doctor');
  const ids = [];
  for (const d of (o.images || []).slice(0, 6)) {
    if (typeof d !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(d)) continue; if (d.length > 900000) throw new Error('image-too-large');
    const id = 'p' + cyrb53(d).toString(36) + '-' + d.length.toString(36); await F.setDoc(F.doc(fs, 'publicImages', id), { data: d, at: Date.now() }); ids.push(id);
  }
  const { images, logo, ...rest } = o;
  await F.setDoc(F.doc(fs, 'public', 'page'), { ...rest, imageIds: ids, images: [], logo: '' });
};
boot();
