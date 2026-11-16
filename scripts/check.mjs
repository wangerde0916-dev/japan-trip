// No-dependency logic regression checks. Run: node scripts/check.mjs
// Uses a minimal DOM stub, not a browser: no layout, rendering, real speech or
// actual service-worker lifecycle is claimed by this script.
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = name => readFile(new URL(name, root), 'utf8');
const [jsonText, generated, source, markup] = await Promise.all([
  read('trip-data.json'), read('data.js'), read('app.js'), read('index.html')
]);
const data = JSON.parse(jsonText);
const plusData = JSON.parse(await read('trip-data-plus.json'));
const storageKey = 'japan-winter-trip:v1';
const pages = ['itinerary', 'explore', 'budget', 'checklist', 'phrases', 'info'];
const plain = value => JSON.parse(JSON.stringify(value));
let passed = 0;
let failed = 0;
async function check(name, run) {
  try { await run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}\n  ${error.stack || error}`); }
}

function boot({ saved, date = [2026, 10, 16, 12], storageDenied = false, writeDenied = false, protocol = 'file:', hostname = '' } = {}) {
  const elements = new Map();
  const listeners = new Map();
  const windowListeners = new Map();
  const local = new Map(saved === undefined ? [] : [[storageKey, typeof saved === 'string' ? saved : JSON.stringify(saved)]]);
  const blobs = [];
  const registrations = [];
  function element(id = '') {
    return {
      id, innerHTML: '', textContent: '', hidden: false, value: '', dataset: {}, style: {},
      open: false, offsetLeft: 0, clientWidth: 100, attributes: {},
      classList: { toggle() {}, add() {}, remove() {} },
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this.attributes[name]; },
      focus() {}, scrollIntoView() {}, append() {}, remove() {}, click() {},
      showModal() { this.open = true; }, close() { this.open = false; },
      reportValidity() { return true; }, checkValidity() { return true; },
      closest() { return this; },
      data: {}, elements: { namedItem: name => get(`field-${name}`) }
    };
  }
  function get(id) { if (!elements.has(id)) elements.set(id, element(id)); return elements.get(id); }
  const pageNodes = pages.map(page => get(`page-${page}`));
  const navNodes = pages.map(page => Object.assign(element(), { dataset: { page } }));
  const document = {
    hidden: false,
    body: element('body'),
    getElementById: get,
    querySelector: selector => get(selector.startsWith('#') ? selector.slice(1) : selector),
    querySelectorAll: selector => selector === '.page' ? pageNodes : selector === '.nav-button' ? navNodes : [],
    createElement: () => element(),
    addEventListener: (name, callback) => listeners.set(name, callback)
  };
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : date)); } }
  class FormDataStub {
    constructor(form) { this.entries = Object.entries(form.data); }
    get(name) { return this.entries.find(([key]) => key === name)?.[1] ?? null; }
    [Symbol.iterator]() { return this.entries[Symbol.iterator](); }
  }
  class URLStub extends URL {
    static createObjectURL(blob) { blobs.push(blob); return `blob:test-${blobs.length}`; }
    static revokeObjectURL() {}
  }
  const context = {
    document, Date: FixedDate, location: { protocol, hostname },
    navigator: { serviceWorker: { register: async url => { registrations.push(url); return {}; }, ready: Promise.resolve({}) } },
    localStorage: {
      getItem: name => { if (storageDenied) throw new Error('Storage denied'); return local.get(name) ?? null; },
      setItem: (name, value) => { if (storageDenied || writeDenied) throw new Error('Storage denied'); local.set(name, value); }
    },
    Blob, URL: URLStub, FormData: FormDataStub, crypto: { randomUUID },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1,
    requestAnimationFrame: callback => callback(), scrollTo() {},
    addEventListener: (name, callback) => windowListeners.set(name, callback), console
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(generated, context, { filename: 'data.js' });
  vm.runInContext(source, context, { filename: 'app.js' });
  const click = dataset => listeners.get('click')({ target: Object.assign(element(), { dataset }) });
  const change = input => listeners.get('change')({ target: input });
  const submit = values => {
    const form = get('expense-form'); form.data = values;
    listeners.get('submit')({ target: form, preventDefault() {} });
  };
  return { context, get, local, blobs, click, change, submit, windowListeners, registrations, saved: () => JSON.parse(local.get(storageKey)), listeners };
}

await check('generated data is structurally identical to trip-data.json', () => {
  const context = { window: {} }; vm.runInNewContext(generated, context);
  assert.deepEqual(plain(context.window.TRIP_DATA), data);
  assert.deepEqual(plain(context.window.TRIP_DATA_PLUS), plusData);
});

await check('file mode initializes all six pages without fetch or SW registration', () => {
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  const app = boot();
  for (const page of pages) assert.ok(app.get(`page-${page}`).innerHTML.length > 50, page);
  assert.equal(app.windowListeners.has('load'), false);
  assert.equal(app.registrations.length, 0);
  assert.match(app.get('page-itinerary').innerHTML, /src="\.\/route-map\.svg"/);
  assert.doesNotMatch(app.get('page-phrases').innerHTML, /data-speak=/);
});

await check('all six navigation buttons select only their matching page', () => {
  const app = boot();
  for (const page of pages) {
    app.click({ page });
    for (const other of pages) assert.equal(app.get(`page-${other}`).hidden, page !== other);
  }
});

await check('mock 2027-02-05 selects D11 and highlights today; out of range selects D1', () => {
  const app = boot({ date: [2027, 1, 5, 12] });
  assert.equal(app.context.TripApp.getDayIndexForDate('2027-02-05'), 10);
  assert.equal(app.context.TripApp.getDayIndexForDate('2026-11-16'), 0);
  assert.equal(app.context.TripApp.getDayIndexForDate('2027-01-26'), 0);
  assert.equal(app.context.TripApp.getDayIndexForDate('2027-02-08'), 13);
  assert.match(app.get('page-itinerary').innerHTML, /id="day-11"[^>]*class="day-button selected is-today"/);
  assert.match(app.get('page-itinerary').innerHTML, /DAY 11/);
  assert.match(boot().get('page-itinerary').innerHTML, /DAY 01/);
});

await check('D9 Mizuya Chaya and D14 Okushiba are closed and sorted last', () => {
  const app = boot();
  for (const [index, name] of [[8, '水谷茶屋'], [13, '奥芝商店 実家']]) {
    const foods = app.context.TripApp.nearbyFoodForDay(data.days[index]);
    assert.equal(foods.at(-1).food.name, name);
    assert.equal(foods.at(-1).closed, true);
    assert.ok(foods.slice(0, -1).every(entry => !entry.closed));
    app.click({ day: String(index) });
    const rendered = app.get('page-itinerary').innerHTML;
    assert.match(rendered, new RegExp(`data-food-name="${name}"[\\s\\S]*?今天休息`));
  }
  const day9 = app.context.TripApp.nearbyFoodForDay(data.days[8]);
  assert.deepEqual([...new Set(day9.map(entry => entry.city.key))].sort(), ['nara', 'osaka']);
});

await check('budget totals use JSON categories and free/mixed price ranges are correct', () => {
  const app = boot();
  const expected = Object.values(data.budget.perPersonJPY).reduce((sum, row) => [sum[0] + row[0], sum[1] + row[1]], [0, 0]);
  assert.deepEqual(plain(app.context.TripApp.budgetTotals()), expected);
  assert.deepEqual(expected, [162000, 234000]);
  assert.equal(app.context.TripApp.yenRange([0, 0]), '免费');
  assert.equal(app.context.TripApp.yenRange([0, 1000]), '¥0–1,000');
});

await check('saved checks, rate and valid expenses restore; invalid expenses are discarded', () => {
  const item = data.days[0].items[0];
  const itemId = JSON.stringify(['item', data.days[0].date, item.time, item.title]);
  const expense = { id: 'saved-1', amount: 2000, category: Object.keys(data.budget.perPersonJPY)[0], date: '2027-01-26', note: '<saved>' };
  const app = boot({ saved: { completed: { [itemId]: true }, rate: 200, expenses: [expense, { ...expense, id: 'bad', amount: -1 }, { ...expense, id: 'bad-date', date: '2000-01-01' }] } });
  assert.match(app.get('page-itinerary').innerHTML, /id="item-1-0"[^>]* checked/);
  assert.match(app.get('page-budget').innerHTML, /value="200"/);
  assert.match(app.get('page-budget').innerHTML, /≈ US\$10/);
  assert.match(app.get('page-budget').innerHTML, /&lt;saved&gt;/);
  assert.match(app.get('page-budget').innerHTML, /1 笔/);
});

await check('check changes persist and restore on a fresh app instance', () => {
  const app = boot();
  const entry = data.checklist[0];
  const id = 'budget:' + JSON.stringify(['checklist', entry.group, entry.item]);
  const input = app.get('checklist-0');
  input.dataset = { toggle: 'checklist', key: id }; input.checked = true;
  app.change(input);
  assert.equal(app.saved().checklist[id], true);
  const reloaded = boot({ saved: app.local.get(storageKey) });
  assert.match(reloaded.get('page-checklist').innerHTML, /id="checklist-0"[^>]* checked/);
});

await check('expense add, CSV escaping, deletion, and saved rate use correct amounts', async () => {
  const app = boot({ saved: { rate: 200 } });
  const category = Object.keys(data.budget.perPersonJPY)[1];
  app.submit({ amount: '1200', category, date: '2027-02-05', note: '=SUM(1,2) "quoted"\nnext' });
  assert.equal(app.saved().expenses.length, 1);
  assert.equal(app.saved().expenses[0].amount, 1200);
  assert.match(app.get('page-budget').innerHTML, /≈ US\$6/);
  app.click({ action: 'export-csv' });
  const csvBytes = new Uint8Array(await app.blobs[0].arrayBuffer());
  assert.deepEqual([...csvBytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const csv = await app.blobs[0].text();
  assert.match(csv, /"2027-02-05","D11"/);
  assert.match(csv, /"1200","6.00","200"/);
  assert.ok(csv.includes('"\'=SUM(1,2) ""quoted""\nnext"'));
  app.click({ deleteExpense: app.saved().expenses[0].id });
  assert.deepEqual(app.saved().expenses, []);
});

await check('rate changes persist and retain the unfinished expense draft', () => {
  const app = boot();
  const draft = { amount: '999', category: Object.keys(data.budget.perPersonJPY)[1], date: '2027-02-05', note: '未提交' };
  app.get('expense-form').data = draft;
  const input = app.get('exchange-rate'); input.value = '180';
  app.change(input);
  assert.equal(app.saved().rate, 180);
  for (const [name, value] of Object.entries(draft)) assert.equal(app.get(`field-${name}`).value, value);
  assert.match(boot({ saved: app.local.get(storageKey) }).get('page-budget').innerHTML, /value="180"/);
});

await check('reset requires the confirmation action and resets only the app state', () => {
  const app = boot({ saved: { rate: 180 } });
  app.local.set('unrelated-app', 'keep');
  app.click({ action: 'open-reset' });
  assert.equal(app.get('reset-dialog').open, true);
  assert.equal(app.saved().rate, 180);
  app.click({ action: 'confirm-reset' });
  assert.equal(app.get('reset-dialog').open, false);
  assert.equal(app.saved().rate, 150);
  assert.equal(app.local.get('unrelated-app'), 'keep');
});

await check('malformed or unavailable storage does not stop app initialization', () => {
  for (const options of [{ saved: '{invalid' }, { storageDenied: true }]) {
    const app = boot(options);
    assert.match(app.get('page-itinerary').innerHTML, /DAY 01/);
    assert.equal(app.get('storage-warning').hidden, false);
  }
});

await check('HTTPS registers the relative SW; ordinary LAN HTTP does not', async () => {
  const secure = boot({ protocol: 'https:', hostname: 'example.test' });
  secure.windowListeners.get('load')();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(secure.registrations, ['./sw.js']);
  const local = boot({ protocol: 'http:', hostname: 'localhost' });
  local.windowListeners.get('load')();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(local.registrations, ['./sw.js']);
  assert.equal(boot({ protocol: 'http:', hostname: '192.168.1.2' }).windowListeners.has('load'), false);
});

await check('HTML and manifest local assets exist and support a project subpath', async () => {
  for (const match of markup.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const path = match[1];
    if (/^(https?:|tel:|#)/.test(path)) continue;
    assert.ok(path.startsWith('./'), `expected relative asset path: ${path}`);
    await access(new URL(path, root));
  }
  const manifest = JSON.parse(await read('manifest.json'));
  assert.equal(manifest.start_url, './index.html');
  assert.equal(manifest.scope, './');
  for (const icon of manifest.icons) await access(new URL(icon.src, root));
});

await check('comfort mode rerenders all pages, D5/D13, calculated budget and ordered upgrade labels', () => {
  const app = boot();
  app.click({ mode: 'plus' });
  app.click({ day: '4' });
  assert.match(app.get('page-itinerary').innerHTML, /住宿区域 · 河口湖湖景温泉旅馆/);
  app.click({ day: '12' });
  assert.match(app.get('page-itinerary').innerHTML, /DAY 13 <span>· 定山溪<\/span>/);
  assert.deepEqual(plain(app.context.TripApp.budgetTotals()), [260000, 395000]);
  assert.match(app.get('page-budget').innerHTML, /¥260,000–395,000/);
  assert.match(app.get('page-budget').innerHTML, /aria-valuemax="395000"/);
  assert.match(app.get('page-info').innerHTML, /舒适版（2 人同住/);
  for (const entry of plusData.checklist) assert.ok(app.get('page-checklist').innerHTML.includes(entry.item));
  const explore = app.get('page-explore').innerHTML;
  assert.equal((explore.match(/class="upgrade-badge"/g) || []).length, plusData.cities.flatMap(city => city.food).filter(food => food.tier === 'plus').length);
  for (const city of plusData.cities) {
    const positions = city.food.map(food => explore.indexOf(`data-food-name="${food.name}"`));
    assert.ok(positions.every((position, index) => position >= 0 && (!index || position > positions[index - 1])));
  }
  app.click({ mode: 'budget' });
  assert.doesNotMatch(app.get('page-explore').innerHTML, /class="upgrade-badge"/);
  assert.deepEqual(plain(app.context.TripApp.budgetTotals()), [162000, 234000]);
  assert.match(app.get('page-info').innerHTML, /青旅/);
});

await check('all five legacy check maps migrate once and stay isolated across modes and reloads', () => {
  const firstDay = data.days[0], firstCity = data.cities[0], list = data.checklist[0];
  const ids = {
    completed: JSON.stringify(['item', firstDay.date, firstDay.items[0].time, firstDay.items[0].title]),
    mustSee: JSON.stringify(['sight', firstCity.key, firstCity.mustSee[0]]),
    wanted: JSON.stringify(['food', firstCity.key, firstCity.food[0].name]),
    eaten: JSON.stringify(['food', firstCity.key, firstCity.food[0].name]),
    checklist: JSON.stringify(['checklist', list.group, list.item])
  };
  const legacy = Object.fromEntries(Object.entries(ids).map(([name, id]) => [name, { [id]: true }]));
  legacy.rate = 170;
  legacy.expenses = [{ id: 'legacy-hotel', amount: 6500, category: Object.keys(data.budget.perPersonJPY)[0], date: firstDay.date, note: '已存住宿' }];
  const original = JSON.stringify(legacy);
  const app = boot({ saved: original });
  for (const [name, id] of Object.entries(ids)) assert.deepEqual(app.saved()[name], { [`budget:${id}`]: true });
  assert.deepEqual(app.saved().expenses, legacy.expenses);
  assert.equal(app.saved().rate, 170);
  app.click({ mode: 'plus' });
  for (const page of ['itinerary', 'explore', 'checklist']) assert.doesNotMatch(app.get(`page-${page}`).innerHTML, / checked|data-food-toggle="[^"]+"[^>]*aria-pressed="true"/);
  for (const [name, id] of Object.entries(ids)) {
    if (['wanted', 'eaten'].includes(name)) app.click({ foodToggle: name, key: `plus:${id}` });
    else { const input = app.get(`test-${name}`); input.dataset = { toggle: name, key: `plus:${id}` }; input.checked = true; app.change(input); }
  }
  const refreshed = boot({ saved: app.local.get(storageKey) });
  assert.equal(refreshed.context.document.title, '日本冬日手帖 · 舒适版');
  assert.equal(refreshed.saved().mode, 'plus');
  for (const [name, id] of Object.entries(ids)) assert.deepEqual(refreshed.saved()[name], { [`budget:${id}`]: true, [`plus:${id}`]: true });
  refreshed.click({ mode: 'budget' });
  assert.match(refreshed.get('page-itinerary').innerHTML, /id="item-1-0"[^>]* checked/);
  assert.match(refreshed.get('page-checklist').innerHTML, /id="checklist-0"[^>]* checked/);
  const before = refreshed.local.get(storageKey);
  assert.equal(boot({ saved: before }).local.get(storageKey), before, 'migration must be idempotent');
  const denied = boot({ saved: original, writeDenied: true });
  assert.equal(denied.local.get(storageKey), original, 'failed migration leaves original bytes intact');
  assert.equal(denied.get('storage-warning').hidden, false);
  assert.match(denied.get('page-itinerary').innerHTML, /id="item-1-0"[^>]* checked/);
});

await check('ledger, accommodation subtotal, exchange rate and CSV are shared in both directions', async () => {
  const app = boot();
  const budgetCategory = Object.keys(data.budget.perPersonJPY)[0];
  const plusCategory = Object.keys(plusData.budget.perPersonJPY)[0];
  app.submit({ amount: '6500', category: budgetCategory, date: data.days[0].date, note: '旧住宿' });
  app.click({ mode: 'plus' });
  app.submit({ amount: '25000', category: plusCategory, date: data.days[4].date, note: '温泉旅馆' });
  const rate = app.get('exchange-rate'); rate.value = '175'; app.change(rate);
  app.click({ mode: 'budget' });
  const refreshed = boot({ saved: app.local.get(storageKey) });
  assert.equal(refreshed.saved().expenses.length, 2);
  assert.equal(refreshed.saved().rate, 175);
  for (const mode of ['budget', 'plus']) {
    refreshed.click({ mode });
    const page = refreshed.get('page-budget').innerHTML;
    assert.match(page, /class="amount">¥31,500/);
    assert.match(page, /已花 ¥31,500/);
    assert.match(page, /aria-valuenow="31500"/);
    assert.match(page, /value="175"/);
  }
  refreshed.click({ action: 'export-csv' });
  const csv = await refreshed.blobs[0].text();
  assert.ok(csv.includes(budgetCategory) && csv.includes(plusCategory));
  refreshed.click({ deleteExpense: refreshed.saved().expenses[1].id });
  refreshed.click({ mode: 'budget' });
  assert.equal(refreshed.saved().expenses.length, 1);
  assert.match(refreshed.get('page-budget').innerHTML, /class="amount">¥6,500/);
});

await check('switch retains selected day, current page and unsaved expense form', () => {
  const app = boot();
  app.click({ day: '4' }); app.click({ page: 'budget' });
  app.get('expense-form').data = { amount: '888', category: Object.keys(data.budget.perPersonJPY)[0], date: data.days[4].date, note: '草稿' };
  app.click({ mode: 'plus' });
  assert.equal(app.get('page-budget').hidden, false);
  assert.match(app.get('page-itinerary').innerHTML, /DAY 05/);
  assert.equal(app.get('field-amount').value, '888');
  assert.equal(app.get('field-note').value, '草稿');
  assert.equal(app.get('field-category').value, Object.keys(plusData.budget.perPersonJPY)[0]);
});

await check('confirmed reset clears both modes and shared ledger without losing selected mode', () => {
  const app = boot({ saved: { mode: 'plus', checklist: { 'budget:test': true, 'plus:test': true }, rate: 190 } });
  app.click({ action: 'confirm-reset' });
  assert.equal(app.saved().mode, 'plus');
  assert.deepEqual(app.saved().checklist, {});
  assert.deepEqual(app.saved().expenses, []);
  assert.equal(app.saved().rate, 150);
  assert.deepEqual(plain(app.context.TripApp.budgetTotals()), [260000, 395000]);
});

await check('v4 offline cache includes both datasets and all local assets', async () => {
  const sw = await read('sw.js');
  const sandbox = { self: { registration: { scope: 'https://example.test/japan-trip/' }, addEventListener() {} }, URL };
  vm.runInNewContext(sw + '\nglobalThis.cacheName = CACHE_NAME; globalThis.assets = ASSETS;', sandbox);
  assert.equal(sandbox.cacheName, 'japan-winter-trip-v4');
  for (const file of ['data.js', 'trip-data.json', 'trip-data-plus.json']) assert.ok(sandbox.assets.includes(`./${file}`));
  for (const asset of sandbox.assets) await access(new URL(asset, root));
});

console.log(`\n${passed} passed; ${failed} failed.`);
console.log('This is a Node logic check. Use a real browser for file://, 375px layout, console, native dialogs, speech, install and offline checks.');
console.log('Original ZIP byte preservation is checked separately; this script does not extract or verify the ZIP.');
process.exitCode = failed ? 1 : 0;
