'use strict';

(() => {
  const DATASETS = { budget: window.TRIP_DATA, plus: window.TRIP_DATA_PLUS, lux: window.TRIP_DATA_LUX };
  const MODE_NAMES = { budget: '穷游版', plus: '舒适版', lux: '豪华版' };
  let DATA = DATASETS.budget;
  if (Object.values(DATASETS).some(data => !data || !Array.isArray(data.days))) {
    document.getElementById('page-itinerary').textContent = '行程数据未加载，请运行 node scripts/build-data.mjs 生成 data.js，并保留完整文件夹。';
    return;
  }
  const STORAGE_KEY = 'japan-winter-trip:v1';
  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
  // Avoid file:// manifest CORS warnings; installation is available over HTTP(S).
  if (['http:', 'https:'].includes(location.protocol)) $('#app-manifest').setAttribute('href', './manifest.json');
  const html = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const number = value => Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const dateLabel = date => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
  const key = (...parts) => JSON.stringify(parts);
  const own = (bag, id) => Object.prototype.hasOwnProperty.call(bag, id) && bag[id] === true;
  const categoryFamily = category => category.replace(/（.*$/, '');
  const defaultRates = DATASETS.budget.meta.currencyRates;
  const blankState = () => ({ mode: 'budget', completed: {}, mustSee: {}, wanted: {}, eaten: {}, checklist: {}, expenses: [], rate: defaultRates.jpyPerUsd, cnyRate: defaultRates.jpyPerCny, currencyDisplay: 'both' });
  let storageIssue = '';
  let needsMigration = false;
  let state = readState();
  DATA = DATASETS[state.mode];
  let cityByKey = new Map(DATA.cities.map(city => [city.key, city]));
  let categoryNames = Object.keys(DATA.budget.perPersonJPY);
  let today = localDate(new Date());
  let selectedDay = getDayIndexForDate(today);
  let currentPage = 'itinerary';
  let cityFilter = 'all';
  let cafeFilter = 'all';
  let mapWidth = 680;
  let toastTimer;

  function localDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function getDayIndexForDate(date) {
    const index = DATA.days.findIndex(day => day.date === date);
    return index < 0 ? 0 : index;
  }
  function budgetTotals() {
    return Object.values(DATA.budget.perPersonJPY).reduce((total, range) => [total[0] + range[0], total[1] + range[1]], [0, 0]);
  }
  function nearbyPlacesForDay(day, collection) {
    const keys = [...new Set([day.cityKey, ...(day.extraCityKeys || [])])];
    return keys.flatMap(cityKey => {
      const city = cityByKey.get(cityKey);
      return (city?.[collection] || []).map(food => ({ city, food, closed: (food.closed || []).includes(day.weekday) }));
    }).sort((a, b) => Number(a.closed) - Number(b.closed));
  }
  function nearbyFoodForDay(day) { return nearbyPlacesForDay(day, 'food'); }
  function nearbyCafesForDay(day) { return nearbyPlacesForDay(day, 'cafes'); }
  function readState() {
    const defaults = blankState();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaults;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Invalid saved state');
      defaults.mode = Object.hasOwn(DATASETS, saved.mode) ? saved.mode : 'budget';
      needsMigration = saved.mode !== defaults.mode;
      for (const name of ['completed', 'mustSee', 'wanted', 'eaten', 'checklist']) {
        if (saved[name] && typeof saved[name] === 'object' && !Array.isArray(saved[name])) {
          // Keep the original content IDs; only add the missing version prefix.
          // One atomic write to the existing storage entry preserves the shared ledger.
          defaults[name] = Object.fromEntries(Object.entries(saved[name]).filter(([, value]) => value === true).map(([id, value]) => {
            if (/^(budget|plus|lux):/.test(id)) return [id, value];
            needsMigration = true;
            return [`budget:${id}`, value];
          }));
        }
      }
      if (Number.isFinite(saved.rate) && saved.rate >= 0.01 && saved.rate <= 100000) defaults.rate = saved.rate;
      if (Number.isFinite(saved.cnyRate) && saved.cnyRate >= 0.01 && saved.cnyRate <= 100000) defaults.cnyRate = saved.cnyRate;
      if (['usd', 'cny', 'both'].includes(saved.currencyDisplay)) defaults.currencyDisplay = saved.currencyDisplay;
      if (Array.isArray(saved.expenses)) {
        defaults.expenses = saved.expenses.filter(expense => expense && typeof expense.id === 'string'
          && Number.isFinite(expense.amount) && expense.amount > 0 && expense.amount <= 1e9
          && Object.values(DATASETS).some(data => Object.hasOwn(data.budget.perPersonJPY, expense.category))
          && Object.values(DATASETS).some(data => data.days.some(day => day.date === expense.date))
          && typeof expense.note === 'string');
      }
      return defaults;
    } catch {
      storageIssue = '浏览器暂时无法读取本地记录；当前操作仍可使用。请检查浏览器的存储权限。';
      return defaults;
    }
  }
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      storageIssue = '';
    } catch {
      storageIssue = '本地存储不可用，当前记录仅保留在此页面，关闭后可能丢失。';
    }
    renderStorageWarning();
  }
  function renderStorageWarning() {
    const warning = $('#storage-warning');
    warning.hidden = !storageIssue;
    warning.textContent = storageIssue;
  }
  function icon(name) {
    const paths = {
      route: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="19" r="2"/><path d="M6 7v7a4 4 0 0 0 4 4h6M10 5h6a4 4 0 0 1 0 8h-3"/>',
      food: '<path d="M5 3v6m3-6v6M3 3v5a3 3 0 0 0 6 0M6 11v10M17 3c-4 4-4 9 0 9h2V3h-2Zm2 9v9"/>',
      wallet: '<path d="M20 8V5H5a2 2 0 0 0 0 4h16v11H5a2 2 0 0 1-2-2V7m18 5h-6v5h6"/><path d="M17 14.5h.01"/>',
      checklist: '<rect x="5" y="4" width="15" height="17" rx="2"/><path d="M9 4V2h7v2M9 10l1 1 2-2m2 1h3M9 16l1 1 2-2m2 1h3"/>',
      speech: '<path d="M21 11a8 8 0 0 1-8 8H8l-5 3 1-6a8 8 0 1 1 17-5Z"/><path d="M8 8h8m-4-2v2m-3 0c0 4 2 6 6 7m0-7c0 4-2 6-6 7"/>',
      info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
      map: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16"/>',
      sight: '<path d="M4 7c6 1 10 1 16 0M5 11h14M8 10v11m8-11v11M7 16h10M12 8v8"/>',
      transport: '<rect x="5" y="3" width="14" height="15" rx="3"/><path d="M5 10h14M9 3v7m6-7v7M8 14h.01M16 14h.01M8 18l-2 3m10-3 2 3"/>',
      stay: '<path d="M3 19V8m18 11v-8H3m0 5h18M6 11V6h12v5"/>',
      arrow: '<path d="m9 5 7 7-7 7"/>',
      expand: '<path d="M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5"/>',
      sound: '<path d="m11 4-5 4H3v8h3l5 4V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
      trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>'
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.sight}</svg>`;
  }
  function conversions(value) {
    const range = Array.isArray(value) ? value : [value, value];
    const currencies = [['usd', 'US$', state.rate], ['cny', 'CN¥', state.cnyRate]];
    return currencies.filter(([currency]) => state.currencyDisplay === 'both' || state.currencyDisplay === currency)
      .map(([currency, label, rate]) => `<span class="converted" data-currency="${currency}">≈ ${label}${number(range[0] / rate)}${range[0] === range[1] ? '' : `–${number(range[1] / rate)}`}</span>`).join(' ');
  }
  const payerName = expense => typeof expense.payer === 'string' ? expense.payer : '';
  function payerTotals() {
    const totals = new Map();
    for (const expense of state.expenses) {
      const payer = payerName(expense);
      totals.set(payer, (totals.get(payer) || 0) + expense.amount);
    }
    return [...totals].map(([payer, amount]) => ({ payer, amount }));
  }
  function yenRange(range) {
    if (range[0] === 0 && range[1] === 0) return '免费';
    return range[0] === range[1] ? `¥${number(range[0])}` : `¥${number(range[0])}–${number(range[1])}`;
  }
  function money(range) {
    return `<span class="price">${yenRange(range)}</span>${range[1] ? `<small class="usd">${conversions(range)}</small>` : ''}`;
  }
  function verify(value) { return value ? '<span class="verify-badge">出发前核实</span>' : ''; }
  function mapLink(query) {
    return query ? `<a class="map-link" href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(query)}" target="_blank" rel="noopener noreferrer" aria-label="在地图中查看 ${html(query)}">${icon('map')}<span>地图</span></a>` : '';
  }
  function pageHeader(kicker, title, subtitle = '') {
    return `<header class="page-header"><span class="eyebrow">${kicker}</span><h1>${title}</h1>${subtitle ? `<p class="lede">${html(subtitle)}</p>` : ''}</header>`;
  }
  function progress(done, total, label) {
    return `<div class="completion-line"><span>${label}</span><strong>${done}/${total}</strong></div><div class="progress-track" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${done}"><span class="progress-fill" style="width:${total ? done / total * 100 : 0}%"></span></div>`;
  }
  const versionKey = (...parts) => `${state.mode}:${key(...parts)}`;
  const itemKey = (day, item) => versionKey('item', day.date, item.time, item.title);
  const foodKey = (city, food) => versionKey('food', city.key, food.name);
  const sightKey = (city, sight) => versionKey('sight', city.key, sight);
  const checklistKey = item => versionKey('checklist', item.group, item.item);

  function renderItinerary() {
    const day = DATA.days[selectedDay];
    const isNearbyOpen = $('#nearby-food')?.open || false;
    const done = day.items.filter(item => own(state.completed, itemKey(day, item))).length;
    const routeStops = [...DATA.meta.route];
    const nara = cityByKey.get('nara');
    const osakaIndex = routeStops.findIndex(stop => stop.startsWith(cityByKey.get('osaka')?.name));
    if (nara && osakaIndex >= 0) routeStops.splice(osakaIndex, 0, `${nara.name} ${nara.nights}`);
    const route = routeStops.map((stop, index) => `<span class="route-stop">${html(stop)}</span>${index < routeStops.length - 1 ? '<span class="route-arrow" aria-hidden="true">→</span>' : ''}`).join('');
    const dayTrips = DATA.cities.filter(city => city.nights.startsWith('一日游')).map(city => `${html(city.name)} · ${html(city.nights)}`).join('<span aria-hidden="true"> / </span>');
    $('#page-itinerary').innerHTML = `
      <div class="map-card"><button class="map-trigger" type="button" data-action="open-map" aria-label="放大日本 14 天路线图"><img src="./route-map.svg" alt="日本 14 天路线示意图：东京、河口湖、京都、奈良、大阪、札幌" width="680" height="590"><span class="map-caption"><span>从东京出发，去北海道看雪</span><span>${icon('expand')} 放大</span></span></button></div>
      <div class="route-strip" aria-label="路线与住宿晚数">${route}</div>
      <p class="route-daytrip note">${dayTrips}</p>
      <div class="section-heading"><div><span class="eyebrow">YOUR WINTER JOURNEY</span><h1>14 天，一路向北</h1></div><span class="pill">${dateLabel(DATA.meta.startDate)} — ${dateLabel(DATA.meta.endDate)}</span></div>
      <div class="date-strip" role="group" aria-label="选择行程日期">${DATA.days.map((entry, index) => `<button id="day-${entry.day}" type="button" class="day-button${index === selectedDay ? ' selected' : ''}${entry.date === today ? ' is-today' : ''}" data-day="${index}" aria-pressed="${index === selectedDay}" aria-label="D${entry.day} ${entry.date} ${html(entry.city)}${entry.date === today ? ' 今天' : ''}"><span class="day-number">D${entry.day}${entry.date === today ? '<span class="today-label">今天</span>' : ''}</span><span class="day-date">${dateLabel(entry.date)} <small>${entry.weekday}</small></span><span class="day-city">${html(entry.city)}</span></button>`).join('')}</div>
      <article class="day-card" aria-labelledby="day-theme">
        <header class="day-card-header"><span class="day-kicker">DAY ${String(day.day).padStart(2, '0')} <span>· ${html(day.city)}</span></span><h2 id="day-theme" class="day-theme">${html(day.theme)}</h2><p class="stay-line">${icon('stay')}<span>住宿区域 · ${html(day.stay)}</span></p><div id="day-progress">${progress(done, day.items.length, '今日行程')}</div></header>
        <ol class="timeline">${day.items.map((item, index) => {
          const id = itemKey(day, item);
          return `<li class="timeline-item${own(state.completed, id) ? ' is-done' : ''}"><div class="timeline-time">${html(item.time)}<span class="timeline-icon" title="${({ sight: '景点', food: '餐饮', transport: '交通', stay: '住宿' })[item.type]}">${icon(item.type)}</span></div><div class="timeline-content"><div class="item-heading"><h3 class="item-title">${html(item.title)}</h3>${verify(item.verify)}</div>${item.titleJa ? `<p class="ja" lang="ja">${html(item.titleJa)}</p>` : ''}${item.note ? `<p class="note">${html(item.note)}</p>` : ''}<div class="item-price">${money(item.costJPY)}</div><div class="item-footer"><label class="check-control"><input id="item-${day.day}-${index}" type="checkbox" data-toggle="completed" data-key="${html(id)}" ${own(state.completed, id) ? 'checked' : ''}><span>已完成</span></label>${mapLink(item.mapQuery)}</div></div></li>`;
        }).join('')}</ol>
        ${day.tips.length ? `<aside class="tips-box"><strong>今日小贴士</strong><ul>${day.tips.map(tip => `<li>${html(tip)}</li>`).join('')}</ul></aside>` : ''}
        <details id="nearby-food" class="nearby-food" ${isNearbyOpen ? 'open' : ''}><summary><span>${icon('food')} 今天附近吃什么</span><span class="note">${nearbyFoodForDay(day).length + nearbyCafesForDay(day).length} 家</span></summary><p class="note">按 ${dateLabel(day.date)} ${day.weekday} 的休息日信息排序</p><div class="food-list">${nearbyFoodForDay(day).map(({ city, food, closed }) => foodCard(city, food, closed, true)).join('')}</div><h3 class="food-section-title">早餐 &amp; 下午茶 <span class="note">${nearbyCafesForDay(day).length} 家</span></h3><div class="food-list nearby-cafes">${nearbyCafesForDay(day).map(({ city, food, closed }) => foodCard(city, food, closed, true)).join('')}</div></details>
      </article>`;
  }
  function foodCard(city, food, closed = false, showCity = false) {
    const id = foodKey(city, food);
    return `<article class="food-card${closed ? ' is-closed' : ''}" data-food-name="${html(food.name)}"${food.category ? ` data-cafe-category="${html(food.category)}"` : ''}>
      ${showCity ? `<span class="city-label">${html(city.name)}</span>` : ''}<div class="food-heading"><h3>${food.tier === 'lux' ? '<span class="lux-badge">豪华</span>' : food.tier === 'plus' ? '<span class="upgrade-badge">升级</span>' : ''}${html(food.name)}</h3>${closed ? '<span class="closed-badge">今天休息</span>' : ''}</div>
      ${food.opens ? `<p class="opening-time">${html(food.opens.replace(/^0/, ''))} 开门</p>` : ''}<p class="rating"><span aria-label="评分">★ ${food.rating.toFixed(1)}</span> · ${number(food.reviews)} 条评价</p><p class="dish">${html(food.dish)}</p><div class="food-price"><span class="note">人均</span> ${money(food.priceJPY)}</div>${food.note ? `<p class="note">${html(food.note)}</p>` : ''}<p class="note">休息日：${food.closed?.length ? html(food.closed.join('、')) : '数据未提供'}</p>
      <div class="food-actions"><button type="button" class="state-button${own(state.wanted, id) ? ' is-active' : ''}" data-food-toggle="wanted" data-key="${html(id)}" aria-pressed="${own(state.wanted, id)}" aria-label="想去 ${html(food.name)}">♡ 想去</button><button type="button" class="state-button${own(state.eaten, id) ? ' is-active' : ''}" data-food-toggle="eaten" data-key="${html(id)}" aria-pressed="${own(state.eaten, id)}" aria-label="吃过 ${html(food.name)}">✓ 吃过</button>${mapLink(food.mapQuery)}</div>
    </article>`;
  }
  function renderExplore() {
    const visibleCities = DATA.cities.filter(city => (cityFilter === 'all' || cityFilter === city.key)
      && (cafeFilter === 'all' || (city.cafes || []).some(cafe => cafe.category === cafeFilter)));
    $('#page-explore').innerHTML = `${pageHeader('TASTE & DISCOVER', '美食与打卡', DATA.meta.ratingsNote)}
      <div class="filter-strip" role="group" aria-label="按城市筛选">${[{ key: 'all', name: '全部' }, ...DATA.cities].map(city => `<button type="button" class="filter-button${cityFilter === city.key ? ' is-active' : ''}" data-filter="${city.key}" aria-pressed="${cityFilter === city.key}">${html(city.name)}</button>`).join('')}</div>
      <div class="filter-strip cafe-filters" role="group" aria-label="按咖啡甜品分类筛选">${[['all', '全部'], ...Object.entries(DATA.cafeCategories)].map(([category, label]) => `<button type="button" class="filter-button${cafeFilter === category ? ' is-active' : ''}" data-cafe-filter="${category}" aria-pressed="${cafeFilter === category}">${html(label)}</button>`).join('')}</div>
      ${visibleCities.map(city => {
        const done = city.mustSee.filter(sight => own(state.mustSee, sightKey(city, sight))).length;
        const cafes = (city.cafes || []).filter(cafe => cafeFilter === 'all' || cafe.category === cafeFilter);
        return `<section class="city-section" data-city-section="${city.key}"><header class="city-heading"><h2>${html(city.name)}</h2><span class="pill">${html(city.nights)}</span></header>
          ${cafeFilter === 'all' ? `<div class="must-see-list"><h3>必去打卡</h3><div data-sight-progress="${city.key}">${progress(done, city.mustSee.length, '已打卡')}</div>${city.mustSee.map((sight, index) => `<label class="check-row${own(state.mustSee, sightKey(city, sight)) ? ' is-done' : ''}"><input id="sight-${city.key}-${index}" type="checkbox" data-toggle="mustSee" data-city="${city.key}" data-key="${html(sightKey(city, sight))}" ${own(state.mustSee, sightKey(city, sight)) ? 'checked' : ''}><span>${html(sight)}</span></label>`).join('')}</div><h3 class="food-section-title">美食推荐 <span class="note">${city.food.length} 家</span></h3><div class="food-list">${city.food.map(food => foodCard(city, food)).join('')}</div>` : ''}
          <section class="cafe-section"><h3 class="food-section-title">咖啡 · 甜品 · 早餐 <span class="note">${cafes.length} 家</span></h3>
            ${Object.entries(DATA.cafeCategories).map(([category, label]) => {
              const entries = cafes.filter(cafe => cafe.category === category);
              return entries.length ? `<div class="cafe-group" data-cafe-group="${category}"><h4>${html(label)} <span class="note">${entries.length} 家</span></h4><div class="food-list">${entries.map(cafe => foodCard(city, cafe)).join('')}</div></div>` : '';
            }).join('')}
          </section></section>`;
      }).join('') || '<div class="empty-state"><h3>这个城市暂无该分类</h3><p class="note">试试其他城市，或选择「全部」。</p></div>'}`;
  }

  function renderBudget() {
    const totals = budgetTotals();
    const spent = state.expenses.reduce((sum, expense) => sum + expense.amount, 0);
    const lowerPercent = totals[0] / totals[1] * 100;
    const remaining = spent > totals[1] ? spent - totals[1] : spent >= totals[0] ? totals[1] - spent : totals[0] - spent;
    const statusLabel = spent > totals[1] ? '超出上限' : spent >= totals[0] ? '已达到预算下限，距离上限还剩' : '距离预算下限还剩';
    $('#page-budget').innerHTML = `${pageHeader('YOUR TRAVEL LEDGER', '旅行账本', '按人记账，把每一笔旅途花费留在这里。')}
      <div class="currency-display"><h2>显示币种</h2><div class="currency-options" role="group" aria-label="显示币种">${[['usd', '日元 + 美元'], ['cny', '日元 + 人民币'], ['both', '日元 + 美元 + 人民币']].map(([value, label]) => `<button type="button" class="filter-button${state.currencyDisplay === value ? ' is-active' : ''}" data-currency-display="${value}" aria-pressed="${state.currencyDisplay === value}">${label}</button>`).join('')}</div></div>
      <section class="summary-card"><span class="eyebrow">已花总额 · 日元</span>
        <div class="budget-total"><strong class="amount">¥${number(spent)}</strong><span class="usd">${conversions(spent)}</span></div>
        <div class="budget-range"><span>每人预算</span><div><strong>${yenRange(totals)}</strong><small class="usd">${conversions(totals)}</small></div></div>
        <div class="budget-meter${spent > totals[1] ? ' overspent' : ''}" role="progressbar" aria-label="已用预算，相对于预算上限" aria-valuemin="0" aria-valuemax="${totals[1]}" aria-valuenow="${Math.min(spent, totals[1])}" aria-valuetext="已花 ${spent} 日元，预算下限 ${totals[0]}，上限 ${totals[1]}"><span class="progress-fill" style="width:${Math.min(spent / totals[1] * 100, 100)}%"></span><span class="budget-marker" style="left:${lowerPercent}%" title="预算下限"></span></div>
        <div class="completion-line budget-limits"><span>下限 ¥${number(totals[0])}<small class="usd">${conversions(totals[0])}</small></span><span>上限 ¥${number(totals[1])}<small class="usd">${conversions(totals[1])}</small></span></div>
        <p class="budget-status">${statusLabel} ¥${number(remaining)}<small class="usd">${conversions(remaining)}</small></p>
      </section>
      <div class="exchange-card">
        <label class="field" for="exchange-rate"><span>美元换算汇率</span><span class="exchange-input"><input id="exchange-rate" type="number" inputmode="decimal" min="0.01" max="100000" step="0.01" value="${state.rate}" required aria-describedby="exchange-hint"><span>日元 = 1 美元</span></span></label>
        <label class="field" for="exchange-cny-rate"><span>人民币换算汇率</span><span class="exchange-input"><input id="exchange-cny-rate" type="number" inputmode="decimal" min="0.01" max="100000" step="0.01" value="${state.cnyRate}" required aria-describedby="exchange-hint"><span>日元 = 1 元人民币</span></span></label>
        <p id="exchange-hint" class="note">数据参考日期 ${html(DATA.meta.currencyRates.asOf)}；可手动修改，用于估算。两种汇率在三个版本间共用，修改后自动保存。</p>
      </div>
      <section class="budget-categories"><h2>预算分配</h2>${categoryNames.map(category => {
        const range = DATA.budget.perPersonJPY[category];
        const subtotal = state.expenses.filter(expense => categoryFamily(expense.category) === categoryFamily(category)).reduce((sum, expense) => sum + expense.amount, 0);
        return `<div class="category-row"><h3>${html(category)}</h3><div>${money(range)}</div><p class="note">已花 ¥${number(subtotal)} <span class="usd">${conversions(subtotal)}</span></p></div>`;
      }).join('')}<p class="tips-box">${html(DATA.budget.note)}</p></section>
      <section class="expense-form-card"><h2>记一笔</h2><form id="expense-form">
        <div class="form-grid"><label class="field" for="expense-amount"><span>金额（日元）</span><input id="expense-amount" name="amount" type="number" min="0.01" max="1000000000" step="0.01" inputmode="decimal" placeholder="例如 1,200" required></label><label class="field" for="expense-category"><span>分类</span><select id="expense-category" name="category">${categoryNames.map(category => `<option>${html(category)}</option>`).join('')}</select></label></div>
        <label class="field" for="expense-date"><span>哪一天</span><select id="expense-date" name="date">${DATA.days.map((day, index) => `<option value="${day.date}"${index === selectedDay ? ' selected' : ''}>D${day.day} · ${dateLabel(day.date)} · ${html(day.city)}</option>`).join('')}</select></label>
        <label class="field" for="expense-payer"><span>谁付的 <small>选填</small></span><input id="expense-payer" name="payer" type="text" maxlength="80" placeholder="例如：小王"></label>
        <label class="field" for="expense-note"><span>备注 <small>选填</small></span><input id="expense-note" name="note" type="text" maxlength="240" placeholder="例如：浅草的第一碗拉面"></label><button type="submit" class="primary-button">＋ 保存支出</button>
      </form></section>
      <section><div class="section-heading"><h2>支出明细 <small class="note">${state.expenses.length} 笔</small></h2><button type="button" class="text-link" data-action="export-csv"${state.expenses.length ? '' : ' disabled'}>导出 CSV</button></div>
        <div class="expense-list">${state.expenses.length ? [...state.expenses].reverse().map(expense => `<article class="expense-row"><div><h3>${html(expense.note || expense.category)}</h3><p class="note">${dateLabel(expense.date)} · ${html(expense.category)}</p><p class="note">付款人：${html(payerName(expense) || '未填写')}</p><strong>¥${number(expense.amount)}</strong> <span class="usd">${conversions(expense.amount)}</span></div><button type="button" class="icon-button" data-delete-expense="${html(expense.id)}" aria-label="删除支出 ${html(expense.note || expense.category)} ${expense.amount} 日元">${icon('trash')}</button></article>`).join('') : '<div class="empty-state"><span aria-hidden="true">¥</span><h3>旅途的第一笔，从这里开始</h3><p class="note">添加交通、餐饮或住宿支出，会自动汇总。</p></div>'}</div>
      </section>
      <section class="payer-totals"><h2>按付款人汇总</h2><p class="note">统计实际垫付金额；未填写姓名的旧记录归入「未填写」，不自动计算分摊。</p>${payerTotals().map(({payer, amount}) => `<article class="payer-row"><h3>${html(payer || '未填写')}</h3><div><strong>¥${number(amount)}</strong><small class="usd">${conversions(amount)}</small></div></article>`).join('') || '<p class="note">保存第一笔支出后会显示汇总。</p>'}</section>`;
  }
  function refreshMoney() {
    const draft = Object.fromEntries(new FormData($('#expense-form')));
    renderBudget(); renderItinerary(); renderExplore();
    for (const [name, value] of Object.entries(draft)) $('#expense-form').elements.namedItem(name).value = value;
  }

  function renderChecklist() {
    const groups = [...new Set(DATA.checklist.map(item => item.group))];
    $('#page-checklist').innerHTML = `${pageHeader('READY FOR THE JOURNEY', '出发前清单', '从证件到防滑靴，准备好就安心出发。')}<div class="summary-card" id="checklist-progress">${progress(DATA.checklist.filter(item => own(state.checklist, checklistKey(item))).length, DATA.checklist.length, '已准备')}</div>${groups.map(group => `<section class="checklist-group"><h2 class="group-heading">${html(group)}</h2>${DATA.checklist.map((item, index) => ({ item, index })).filter(({ item }) => item.group === group).map(({ item, index }) => `<label class="check-row${own(state.checklist, checklistKey(item)) ? ' is-done' : ''}"><input id="checklist-${index}" type="checkbox" data-toggle="checklist" data-key="${html(checklistKey(item))}" ${own(state.checklist, checklistKey(item)) ? 'checked' : ''}><span>${html(item.item)}${item.verify ? `<span class="check-verify">${verify(true)}</span>` : ''}</span></label>`).join('')}</section>`).join('')}`;
  }
  const canSpeak = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  function renderPhrases() {
    $('#page-phrases').innerHTML = `${pageHeader('A LITTLE JAPANESE', '旅途日语', canSpeak ? '点日文听发音，或打开出示模式给对方看。' : '打开出示模式，让对方直接看清日文。')}${DATA.phrases.map((phrase, index) => `<article class="phrase-card"><div class="phrase-zh"><span class="phrase-index">${String(index + 1).padStart(2, '0')}</span><h2>${html(phrase.zh)}</h2></div>${canSpeak ? `<button type="button" class="phrase-speak" data-speak="${index}" aria-label="朗读 ${html(phrase.ja)}"><span class="phrase-ja" lang="ja">${html(phrase.ja)}</span>${icon('sound')}</button>` : `<p class="phrase-ja" lang="ja">${html(phrase.ja)}</p>`}<p class="romaji">${html(phrase.romaji)}</p><div class="phrase-actions"><button type="button" class="secondary-button" data-show-phrase="${index}">${icon('expand')} 出示模式</button></div></article>`).join('')}`;
  }
  function renderInfo() {
    $('#page-info').innerHTML = `${pageHeader('GOOD TO KNOW', '旅行信息', DATA.meta.title)}<section class="info-card"><h2>这次旅程</h2><dl class="info-list"><dt>出行时间</dt><dd>${DATA.meta.startDate} — ${DATA.meta.endDate}</dd><dt>同行人数</dt><dd>${html(DATA.meta.travelers)}</dd><dt>旅行方式</dt><dd>${html(DATA.meta.style)}</dd><dt>路线</dt><dd>${html(DATA.meta.route.join(' → '))}</dd></dl></section><section class="info-card"><h2>机票与交通</h2><p>${html(DATA.meta.flightsNote)}</p></section><section class="info-card"><h2>费用说明</h2><p>${html(DATA.meta.disclaimer)}</p></section><section class="info-card"><h2>紧急联系</h2><div class="emergency-list">${DATA.emergency.map(contact => `<a class="emergency-link" href="tel:${contact.number.replace(/[^\d+]/g, '')}"><span>${html(contact.name)} ${verify(contact.verify)}</span><strong>${html(contact.number)}</strong></a>`).join('')}</div></section><section class="info-card"><h2>随身与离线</h2><p>行程、记账和勾选都保存在这个浏览器中。地图搜索需要联网，朗读是否可离线取决于设备的日语语音。</p><p id="offline-status" class="note">${location.protocol === 'file:' ? '当前为本地文件模式；保留完整文件夹即可离线查看。' : navigator.serviceWorker?.controller ? '离线资源已就绪，可在此浏览器离线打开。' : '首次联网打开后会准备离线资源。'}</p><p class="note">添加到主屏幕：通过 HTTPS 或 localhost 打开，使用浏览器菜单；iPhone 可在 Safari 分享菜单中选择“添加到主屏幕”。</p></section><section class="info-card"><h2>本地记录</h2><p class="note">三个版本的勾选分别保存，支出和两种汇率共用。重置会清除三个版本的本地记录，请先在预算页导出支出。</p><button type="button" class="danger-button" data-action="open-reset">重置所有本地数据</button></section>`;
  }
  function renderAll() {
    renderItinerary(); renderExplore(); renderBudget(); renderChecklist(); renderPhrases(); renderInfo(); renderStorageWarning();
    $$('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode)));
    document.title = `日本冬日手帖 · ${MODE_NAMES[state.mode]}`;
  }
  function switchMode(mode) {
    if (!Object.hasOwn(DATASETS, mode) || mode === state.mode) return;
    const selectedDate = DATA.days[selectedDay].date;
    const draft = Object.fromEntries(new FormData($('#expense-form')));
    state.mode = mode;
    DATA = DATASETS[mode];
    cityByKey = new Map(DATA.cities.map(city => [city.key, city]));
    categoryNames = Object.keys(DATA.budget.perPersonJPY);
    selectedDay = getDayIndexForDate(selectedDate);
    if (!cityByKey.has(cityFilter)) cityFilter = 'all';
    saveState();
    renderAll();
    // Both itineraries describe the same trip: keep an unfinished ledger entry too.
    for (const [name, value] of Object.entries(draft)) {
      $('#expense-form').elements.namedItem(name).value = name === 'category'
        ? categoryNames.find(category => categoryFamily(category) === categoryFamily(value)) || categoryNames[0]
        : value;
    }
    if (currentPage === 'itinerary') requestAnimationFrame(scrollSelectedDay);
    toast(`已切换到${MODE_NAMES[mode]}`);
  }
  function scrollSelectedDay() {
    const strip = $('.date-strip');
    const selected = $('.day-button.selected');
    if (strip && selected) strip.scrollLeft = selected.offsetLeft - strip.offsetLeft - (strip.clientWidth - selected.clientWidth) / 2;
  }
  function navigate(page) {
    if (!$('#page-' + page)) return;
    currentPage = page;
    $$('.page').forEach(section => { section.hidden = section.id !== 'page-' + page; });
    $$('.nav-button').forEach(button => {
      const active = button.dataset.page === page;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    });
    if (page === 'itinerary') requestAnimationFrame(scrollSelectedDay);
    window.scrollTo({ top: 0, behavior: 'instant' });
    $('#main').focus({ preventScroll: true });
  }
  function toast(message) {
    clearTimeout(toastTimer);
    $('#toast').textContent = message;
    $('#toast').hidden = false;
    toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3200);
  }
  function openDialog(id) { const dialog = document.getElementById(id); if (!dialog.open) dialog.showModal(); }
  function closeDialog(id) { document.getElementById(id).close(); }
  function updateProgress() {
    const day = DATA.days[selectedDay];
    $('#day-progress').innerHTML = progress(day.items.filter(item => own(state.completed, itemKey(day, item))).length, day.items.length, '今日行程');
    $('#checklist-progress').innerHTML = progress(DATA.checklist.filter(item => own(state.checklist, checklistKey(item))).length, DATA.checklist.length, '已准备');
    $$('[data-sight-progress]').forEach(element => {
      const city = cityByKey.get(element.dataset.sightProgress);
      element.innerHTML = progress(city.mustSee.filter(sight => own(state.mustSee, sightKey(city, sight))).length, city.mustSee.length, '已打卡');
    });
  }
  function exportCSV() {
    const csvCell = value => {
      let text = String(value);
      if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
      return '"' + text.replace(/"/g, '""') + '"';
    };
    const rows = [['日期', '行程日', '分类', '金额（日元）', '美元约数', '汇率（日元/美元）', '备注', '谁付的', '人民币约数', '汇率（日元/人民币）'], ...state.expenses.map(expense => [expense.date, 'D' + DATA.days.find(day => day.date === expense.date).day, expense.category, expense.amount, (expense.amount / state.rate).toFixed(2), state.rate, expense.note, payerName(expense), (expense.amount / state.cnyRate).toFixed(2), state.cnyRate])];
    const csv = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url; link.download = '日本冬季旅行账本.csv'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('账本已导出为 CSV');
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.mode) { switchMode(button.dataset.mode); return; }
    if (button.dataset.page) { navigate(button.dataset.page); return; }
    if (button.dataset.currencyDisplay) {
      if (!['usd', 'cny', 'both'].includes(button.dataset.currencyDisplay)) return;
      state.currencyDisplay = button.dataset.currencyDisplay; saveState(); refreshMoney();
      $(`[data-currency-display="${state.currencyDisplay}"]`).focus({ preventScroll: true });
      return;
    }
    if (button.dataset.day !== undefined) {
      selectedDay = Number(button.dataset.day);
      renderItinerary(); scrollSelectedDay();
      $(`#day-${DATA.days[selectedDay].day}`).focus({ preventScroll: true });
      $('#expense-date').value = DATA.days[selectedDay].date;
      return;
    }
    if (button.dataset.filter) {
      cityFilter = button.dataset.filter;
      renderExplore();
      const activeFilter = $(`[data-filter="${cityFilter}"]`);
      activeFilter.focus({ preventScroll: true });
      activeFilter.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return;
    }
    if (button.dataset.cafeFilter) {
      cafeFilter = button.dataset.cafeFilter;
      renderExplore();
      const activeFilter = $(`[data-cafe-filter="${cafeFilter}"]`);
      activeFilter.focus({ preventScroll: true });
      activeFilter.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return;
    }
    if (button.dataset.foodToggle) {
      const group = button.dataset.foodToggle, id = button.dataset.key;
      if (own(state[group], id)) delete state[group][id]; else state[group][id] = true;
      saveState();
      $$('[data-food-toggle]').filter(other => other.dataset.foodToggle === group && other.dataset.key === id).forEach(other => {
        other.classList.toggle('is-active', own(state[group], id)); other.setAttribute('aria-pressed', String(own(state[group], id)));
      });
      return;
    }
    if (button.dataset.deleteExpense) {
      state.expenses = state.expenses.filter(expense => expense.id !== button.dataset.deleteExpense);
      saveState(); renderBudget(); toast('已删除这笔支出'); return;
    }
    if (button.dataset.speak !== undefined && canSpeak) {
      const phrase = DATA.phrases[Number(button.dataset.speak)];
      try {
        speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(phrase.ja);
        utterance.lang = 'ja-JP'; utterance.rate = 0.85;
        const voice = speechSynthesis.getVoices().find(entry => entry.lang.toLowerCase().startsWith('ja'));
        if (voice) utterance.voice = voice;
        utterance.onerror = error => { if (!['canceled', 'interrupted'].includes(error.error)) toast('日语语音暂不可用，可使用出示模式。'); };
        speechSynthesis.speak(utterance);
      } catch { toast('日语语音暂不可用，可使用出示模式。'); }
      return;
    }
    if (button.dataset.showPhrase !== undefined) {
      const phrase = DATA.phrases[Number(button.dataset.showPhrase)];
      $('#display-japanese').textContent = phrase.ja; $('#display-translation').textContent = phrase.zh; $('#display-romaji').textContent = phrase.romaji;
      openDialog('phrase-dialog'); return;
    }
    if (button.dataset.close) { closeDialog(button.dataset.close); return; }
    switch (button.dataset.action) {
      case 'open-map': openDialog('map-dialog'); break;
      case 'map-smaller': case 'map-larger':
        mapWidth = Math.max(340, Math.min(1360, mapWidth + (button.dataset.action === 'map-larger' ? 170 : -170)));
        $('#large-route-map').style.width = mapWidth + 'px'; break;
      case 'export-csv': exportCSV(); break;
      case 'open-reset': openDialog('reset-dialog'); break;
      case 'confirm-reset':
        state = { ...blankState(), mode: state.mode }; saveState(); closeDialog('reset-dialog'); renderAll(); toast('已重置本 App 的本地记录'); break;
    }
  });
  document.addEventListener('change', event => {
    const input = event.target;
    if (input.dataset.toggle) {
      const group = input.dataset.toggle;
      if (input.checked) state[group][input.dataset.key] = true; else delete state[group][input.dataset.key];
      saveState();
      input.closest('.timeline-item, .check-row')?.classList.toggle('is-done', input.checked);
      updateProgress();
    }
    if (['exchange-rate', 'exchange-cny-rate'].includes(input.id)) {
      const rate = Number(input.value);
      if (!input.checkValidity() || !Number.isFinite(rate) || rate < 0.01 || rate > 100000) { input.reportValidity(); return; }
      state[input.id === 'exchange-rate' ? 'rate' : 'cnyRate'] = rate; saveState();
      refreshMoney();
      $('#' + input.id).focus({ preventScroll: true }); toast('汇率已保存');
    }
  });
  document.addEventListener('submit', event => {
    if (event.target.id !== 'expense-form') return;
    event.preventDefault();
    if (!event.target.reportValidity()) return;
    const form = new FormData(event.target);
    const amount = Math.round(Number(form.get('amount')) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) return;
    state.expenses.push({ id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2), amount, category: form.get('category'), date: form.get('date'), note: String(form.get('note')).trim(), payer: String(form.get('payer') || '').trim() });
    saveState(); renderBudget(); toast('支出已保存');
  });
  function refreshToday() {
    const nextToday = localDate(new Date());
    if (today !== nextToday) { today = nextToday; selectedDay = getDayIndexForDate(today); renderItinerary(); if (currentPage === 'itinerary') scrollSelectedDay(); }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshToday(); });
  setInterval(refreshToday, 60000);
  // Read-only helpers support repeatable data and date checks without changing the itinerary.
  window.TripApp = Object.freeze({ getDayIndexForDate, budgetTotals, nearbyFoodForDay, nearbyCafesForDay, localDate, yenRange, payerTotals });
  $$('[data-icon]').forEach(element => { element.innerHTML = icon(element.dataset.icon); });
  if (needsMigration) saveState();
  renderAll();
  requestAnimationFrame(scrollSelectedDay);
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || (location.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)))) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then(() => navigator.serviceWorker.ready).then(() => {
        const status = $('#offline-status'); if (status) status.textContent = '离线资源已就绪，可在此浏览器离线打开。';
      }).catch(() => { /* Local file mode and unavailable SW must never interrupt the app. */ });
    });
  }
})();
