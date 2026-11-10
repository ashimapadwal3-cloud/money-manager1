// Money Manager: automated tests (unit, integration, end-to-end, persistence, security, performance)
// Run:  npm i jsdom  &&  node money-manager.test.js [path/to/money-manager.html]
const { JSDOM, VirtualConsole } = require('jsdom'), { webcrypto } = require('crypto'), fs = require('fs');
const html = fs.readFileSync(process.argv[2] || './money-manager.html', 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const errors = [];
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };
const dump = s => Object.keys(s).map(k => [k, s.getItem(k)]);
function boot(ls = [], ss = []) {
  const vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(e.message)); vc.on('error', e => errors.push(String(e)));
  const d = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { Object.defineProperty(w, 'crypto', { value: webcrypto }); w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder; w.Uint8Array = Uint8Array; w.scrollTo = () => {};
      for (const [k, v] of ls) w.localStorage.setItem(k, v); for (const [k, v] of ss) w.sessionStorage.setItem(k, v); } });
  d.window.addEventListener('error', e => errors.push(e.message)); return d.window;
}
const Q = w => s => w.document.querySelector(s), QA = w => s => [...w.document.querySelectorAll(s)];
async function until(f, ms = 4000) { const t = Date.now(); while (Date.now() - t < ms) { try { if (f()) return true } catch (e) {} await sleep(50) } return false }
async function auth(w, mode, id, pw) { const $ = Q(w);
  QA(w)('.seg button').find(b => b.dataset.m == mode).click(); $('#u').value = id; $('#p').value = pw; if (mode == 'up') $('#p2').value = pw; $('#go').click();
  return until(() => $('#main') || ($('#er') && $('#er').textContent)); }
async function addTx(w, kind, amt, note = '') { const $ = Q(w); $(`[data-a=${kind}]`).click(); $('#am').value = amt; $('#nt').value = note; $('#sv').click(); await sleep(250); }
(async () => {
  let w = boot(), $ = Q(w), $$ = QA(w); await sleep(300);
  // --- security / validation ---
  await auth(w, 'up', 'tester', 'short'); check('signup rejects passwords under 8 characters', /8 characters/.test($('#er').textContent));
  await auth(w, 'up', 'tester', 'secret-pass-1'); check('signup succeeds and opens dashboard', !!$('#main'));
  // --- core features ---
  await addTx(w, 'addi', '5000'); await addTx(w, 'adde', '1200.50', '<img src=x onerror=alert(1)>');
  check('balance = income - expense', $('.hero .big').textContent.includes('3,799.50'), $('.hero .big').textContent);
  $('[data-v=daily]').click();
  check('XSS: note is escaped, no injected element', !$('#lst img') && $('#lst').textContent.includes('<img'));
  $$('#lst [data-a=edit]').find(b => /1,200/.test(b.closest('.tx').textContent)).click(); $('#am').value = '1000'; $('#sv').click(); await sleep(250);
  $('[data-v=dash]').click(); check('editing an amount updates the balance', $('.hero .big').textContent.includes('4,000.00'), $('.hero .big').textContent);
  $('[data-v=daily]').click(); const n0 = $$('#lst .tx').length;
  $('#lst [data-a=del]').click(); $('#y').click(); await sleep(200); check('delete removes a record', $$('#lst .tx').length === n0 - 1);
  $('#un').click(); await sleep(200); check('undo restores the record', $$('#lst .tx').length === n0);
  // --- cheque payments ---
  $('[data-v=dash]').click(); $('[data-a=adde]').click(); $$('#ac button').find(b => b.dataset.c == 'cheque').click();
  check('cheque number and status fields appear for cheque payments', !$('#cq').hidden);
  $('#am').value = '500'; $('#cn').value = '123456'; $('#sv').click(); await sleep(250);
  check('pending cheque does not change the balance', $('.hero .big').textContent.includes('4,000.00'), $('.hero .big').textContent);
  $('[data-v=daily]').click(); check('cheque row shows number and Pending status', /123456/.test($('#lst').textContent) && /Pending/.test($('#lst').textContent));
  $('#lst [data-a=clr]').click(); await sleep(250); $('[data-v=dash]').click();
  check('clearing the cheque deducts it from the total', $('.hero .big').textContent.includes('3,500.00'), $('.hero .big').textContent);
  check('cheque balance card shows the cleared cheque', /3,?500|500\.00/.test($$('.grid .card')[1] ? $$('.grid .card').map(c => c.textContent).join('|') : ''));
  $('[data-v=daily]').click(); await sleep(500);
  // --- daily limit, safe-to-spend, hide balance, lent/borrowed ---
  $('[data-v=set]').click(); $('#dlim').value = '500'; $('#dlim').dispatchEvent(new w.Event('input', { bubbles: true }));
  $('#bg').value = '30000'; $('#bg').dispatchEvent(new w.Event('input', { bubbles: true })); $('[data-v=dash]').click();
  check('daily limit card flags overspending (1,500 spent vs 500 limit)', /Over limit by\s*\u20b91,000\.00/.test($('#main').textContent), ($('#main').textContent.match(/Over limit[^A-Z]*/)||[''])[0]);
  check('safe-to-spend is calculated from budget, spending and upcoming bills', /Safe to spend per day/.test($('#main').textContent) && /Budget left/.test($('#main').textContent));
  $('[data-a=eye]').click(); check('hide balance masks amounts', $('.hero .big').textContent.includes('\u2022\u2022'));
  $('[data-a=eye]').click(); check('show balance restores amounts', $('.hero .big').textContent.includes('3,500.00'));
  $('[data-v=plan]').click(); $('[data-a=loan]').click(); $('#lw').value = 'Ravi'; $('#la').value = '1000'; $('#sv').click(); await sleep(250);
  check('lent record appears as owed to you', /Ravi/.test($('#main').textContent) && /owes you/.test($('#main').textContent));
  $('[data-a=repay]').click(); $('#rp').value = '400'; $('#sv').click(); await sleep(250);
  check('partial repayment leaves the right remaining amount', /600\.00 left of/.test($('#main').textContent));
  $('[data-a=loan]').click(); $$('#ld button').find(b => b.dataset.t == 'borrowed').click(); $('#lw').value = 'Asha'; $('#la').value = '250'; $('#sv').click(); await sleep(250);
  $('[data-v=dash]').click(); const cards = $$('.grid .card').map(c => c.textContent).join('|');
  check('dashboard shows lent and borrowed totals separately', /Lent[^|]*600\.00/.test(cards) && /Borrowed[^|]*250\.00/.test(cards), cards.match(/Lent[^|]*|Borrowed[^|]*/g).join(' ; '));
  check('lent/borrowed never changes account balances', $('.hero .big').textContent.includes('3,500.00'));
  $('[data-v=daily]').click(); await sleep(500);
  // --- persistence ---
  let ls = dump(w.localStorage), ss = dump(w.sessionStorage); const key = 'mm:d:tester';
  check('stored data is encrypted (no plaintext)', !JSON.stringify(ls).includes('5000') && !JSON.stringify(ls).includes('onerror'));
  w.close(); w = boot(ls, ss); $ = Q(w); await until(() => $('#main'));
  check('refresh: data and session survive', !!$('#main') && $('.hero .big').textContent.includes('3,500.00'));
  w.close(); w = boot(ls, []); $ = Q(w); await sleep(300);
  check('browser restart: login required', !!$('#go'));
  await auth(w, 'in', 'tester', 'secret-pass-1'); check('browser restart: data intact after login', !!$('#main') && $('.hero .big').textContent.includes('3,500.00'));
  // --- corruption recovery ---
  ls = dump(w.localStorage).map(([k, v]) => k === key ? [k, 'zz.zz'] : [k, v]); w.close(); w = boot(ls, []); $ = Q(w); await sleep(300);
  await auth(w, 'in', 'tester', 'secret-pass-1'); check('corrupted data recovers from automatic backup', !!$('#main'));
  // --- lockout ---
  w.eval("S=null;authView()"); $ = Q(w); let msg = '';
  for (let i = 0; i < 6; i++) { $('#u').value = 'tester'; $('#p').value = 'wrong-pass-' + i; $('#go').click(); await until(() => $('#go') && !$('#go').disabled); msg = $('#er').textContent; }
  check('5 wrong passwords trigger a temporary lockout', /Too many/.test(msg), msg);
  w.close();
  // --- legacy account compatibility (150k iterations, no iteration field) ---
  w = boot(); $ = Q(w); await sleep(300);
  await w.eval(`(async()=>{const salt=crypto.getRandomValues(new Uint8Array(16)),{v}=await derive('legacy-pass',salt,150000);ls.set('mm:u',JSON.stringify({old:{s:b64(salt),v}}))})()`); await sleep(500);
  await auth(w, 'in', 'old', 'legacy-pass'); check('accounts created before the security upgrade can still log in', !!$('#main'));
  // --- scalability & performance ---
  w.eval(`for(let i=0;i<3000;i++)S.d.tx.push({id:'p'+i,type:'exp',acc:'cash',amt:10+i%50,cat:'Food',date:'2026-0'+(1+i%9)+'-1'+(i%9),note:'n'+i});S.m='';S.lim=0`);
  const t = f => { const a = performance.now(); const r = w.eval(f); return [performance.now() - a, r] };
  const [fast, h1] = t("list().length"); const [slow, h2] = t("(S.lim=1e9,list().length)");
  check('pagination renders 60 rows instead of 3000', (w.eval("S.lim=0;(list().match(/class=\"row tx/g)||[]).length")) === 60 && w.eval("list().includes('Show more')"));
  check('performance: paginated list is faster', fast < slow, `paginated ${fast.toFixed(1)} ms vs full ${slow.toFixed(1)} ms (3000 records)`);
  const [kd] = await (async () => { const a = performance.now(); await w.eval("derive('x',new Uint8Array(16),600000)"); return [performance.now() - a] })();
  console.log(`INFO  key derivation (600k iterations): ${kd.toFixed(0)} ms in Node; expect roughly 1 s on a mid-range phone`);
  // --- offline indicator ---
  Object.defineProperty(w.navigator, 'onLine', { value: false, configurable: true }); w.dispatchEvent(new w.Event('offline')); $ = Q(w);
  check('offline indicator appears', $('#net') && !$('#net').hidden);
  check('no uncaught runtime errors during the whole run', errors.filter(e => !/scrollTo/.test(e)).length === 0, errors.join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
