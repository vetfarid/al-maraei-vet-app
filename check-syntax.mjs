// يفحص صياغة كل ملفات الجافاسكريبت والسكربتات المضمنة في HTML
import fs from 'node:fs'; import { execFileSync } from 'node:child_process'; import path from 'node:path'; import os from 'node:os';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'); let bad = 0;
const chk = (name, code, mod) => { const f = path.join(os.tmpdir(), 'chk-' + Math.random().toString(36).slice(2) + (mod ? '.mjs' : '.js')); fs.writeFileSync(f, code); try { execFileSync('node', ['--check', f], { stdio: 'pipe' }); console.log('OK  ', name); } catch (e) { bad++; console.log('FAIL', name, String(e.stderr).split('\n').slice(0, 3).join(' ')); } };
for (const f of ['sw.js', 'app-cloud.js', 'firebase-config.js', 'lib/sync-core.js', 'lib/backup.js']) chk(f, fs.readFileSync(path.join(root, f), 'utf8'), f !== 'sw.js' ? true : false);
for (const h of ['index.html', 'customer.html']) { const s = fs.readFileSync(path.join(root, h), 'utf8'); [...s.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)].forEach((m, i) => { if (m[2].trim()) chk(h + '#script' + i, m[2], /type="module"/.test(m[1])); }); }
process.exit(bad ? 1 : 0);
