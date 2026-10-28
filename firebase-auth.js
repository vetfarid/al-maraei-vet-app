const subs = new Set(); const cur = () => { try { return JSON.parse(sessionStorage.getItem('fakeuser') || 'null'); } catch (e) { return null; } };
const fire = () => subs.forEach(f => f(cur()));
export const getAuth = () => ({ get currentUser() { return cur(); } });
export const onAuthStateChanged = (a, cb) => { subs.add(cb); setTimeout(() => cb(cur()), 20); return () => subs.delete(cb); };
export const signInWithEmailAndPassword = async (a, email, pw) => { const u = await window.__fakeCall('signIn', { email, pw }); sessionStorage.setItem('fakeuser', JSON.stringify(u)); fire(); return { user: u }; };
export const signInAnonymously = async () => { let id = localStorage.getItem('fakeanon'); if (!id) { id = 'anon-' + Math.random().toString(36).slice(2); localStorage.setItem('fakeanon', id); } const u = { uid: id, isAnonymous: true }; sessionStorage.setItem('fakeuser', JSON.stringify(u)); fire(); return { user: u }; };
export const signOut = async () => { sessionStorage.removeItem('fakeuser'); fire(); };
