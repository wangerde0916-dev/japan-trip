# 任务：做一个「日本冬季 14 天穷游」手机网页 App

你是负责写代码的工程师。行程内容已经由规划方定好，放在同目录的 `trip-data.json` 里。
**不要改写行程内容**，只负责把它做成一个好用的手机网页。数据有问题时，在 `NOTES.md` 里列出来，不要自己改。

## 1. 技术要求

- 纯静态网站，**不需要构建工具**：`index.html` + `styles.css` + `app.js` + `data.js`
- `data.js` 由 `trip-data.json` 生成：`window.TRIP_DATA = { ...JSON 内容... };`
  - 写一个小脚本 `scripts/build-data.mjs`（Node，无依赖），运行 `node scripts/build-data.mjs` 就重新生成 `data.js`
  - 这样直接双击 `index.html`（file://）也能打开，不会因为 fetch 本地 JSON 报错
- 不用任何框架和 CDN，全部代码离线可用
- 加 PWA：`manifest.json` + `sw.js`（缓存全部静态文件，离线可用，可「添加到主屏幕」）。用 file:// 打开时 service worker 注册失败要静默处理
- 能直接部署到 GitHub Pages（全部用相对路径）
- 界面语言：简体中文；日文名（`titleJa`）作为副标题显示

## 2. 页面与功能

底部 Tab 导航，6 个页面：

### ① 行程（首页）
- 最上方显示路线图 `route-map.svg`（用 `<img>` 引入，宽度 100%，点击可放大查看）
- 路线图下面：路线概览条（东京 → 河口湖 → 京都 → 奈良/大阪 → 札幌），显示每段住几晚
- 横向滑动的日期选择条（D1–D14，显示日期 + 城市）
- **自动定位到「今天」**：如果当前日期在 2027-01-26 ~ 2027-02-08 之间，默认打开当天并高亮「今天」；不在范围内就打开 D1
- 每天一张卡片：主题、住宿区域、时间线列表
- 时间线每一项：时间、图标（按 `type`：sight 景点 / food 吃 / transport 交通 / stay 住宿）、标题、日文名、备注、费用区间（如「¥800–1,000」，0 显示「免费」）
- `verify: true` 的项目显示一个小的黄色「出发前核实」标签
- 每一项有「地图」按钮：打开 `https://www.google.com/maps/search/?api=1&query=` + encodeURIComponent(mapQuery)，新标签打开
- 当天的 `tips` 用提示框放在卡片底部
- 每项可以勾选「已完成」（存 localStorage），勾选后变灰
- 每天卡片底部加一个「今天附近吃什么」折叠区：根据该天的 `cityKey`（以及 `extraCityKeys`）列出 `cities` 里对应城市的 `food`
  - 如果店铺的 `closed` 里包含这一天的 `weekday`，显示红色「今天休息」标签，并排到列表最后

### ② 美食 & 打卡（新页面）
- 按 `cities` 的顺序分组，每个城市一个区块：城市名 + `nights`
- 「必去打卡」：`mustSee` 列表，每项可勾选「已打卡」（存 localStorage），显示完成进度
- 「美食推荐」：每家店一张小卡片：店名、招牌菜 `dish`、评分（★ 4.8 · 13,871 条评价）、人均 `priceJPY` 区间、`note`、`closed` 休息日、「地图」按钮（同上，用 `mapQuery`）
- 每家店可以标记「想去 ♡」和「吃过 ✓」（存 localStorage）
- 页面顶部显示 `meta.ratingsNote`，说明评分是某一天的快照
- 顶部加城市筛选（全部 / 东京 / 河口湖 / …）

### ③ 预算
- 显示 `budget.perPersonJPY` 各分类的区间和合计（合计要用代码算，不要写死）
- **记账功能**：添加一笔支出（金额、分类、哪一天、备注），存 localStorage
- 显示：已花总额、按分类小计、和预算上下限对比的进度条
- 汇率输入框（默认 150 日元 = 1 美元，可改，存 localStorage），金额旁同时显示美元约数
- 支持删除单笔、导出为 CSV

### ④ 清单
- 按 `checklist` 的 `group` 分组显示，可勾选，存 localStorage
- 显示完成进度（如 5/12）

### ⑤ 日语
- `phrases` 列表：中文、日文大字、罗马音
- 点日文那行，用 `speechSynthesis`（lang = ja-JP）朗读；浏览器不支持就隐藏朗读按钮
- 「出示模式」：点一下全屏显示日文大字，方便直接给店员看

### ⑥ 信息
- `meta` 里的路线、出行人数、`flightsNote`、`disclaimer`
- `emergency` 紧急电话，号码做成 `tel:` 链接
- 「重置所有本地数据」按钮（要先确认）

## 3. 设计要求

- 手机优先（375–430px 宽），桌面端居中显示，最大宽度约 480px
- 冬日主题：白/浅灰底，深蓝主色，点缀一点红（像雪地里的鸟居）；同时支持深色模式（`prefers-color-scheme`）
- 字体用系统字体栈，中日文都要清楚
- 点击区域至少 44px；适配 iPhone 刘海和底部安全区（`env(safe-area-inset-*)`）
- 不要用外部图片；图标用内联 SVG 或 emoji

## 4. 交付物

```
index.html
styles.css
app.js
data.js            （脚本生成）
trip-data.json     （原样保留）
route-map.svg      （原样保留，sw.js 要缓存它）
manifest.json
sw.js
icons/             （用 SVG 或代码生成的简单 PNG 图标）
scripts/build-data.mjs
README.md          （怎么本地打开、怎么改行程、怎么部署到 GitHub Pages）
NOTES.md           （发现的数据问题、没做完的地方）
```

## 5. 完成前自检

- [ ] 双击 `index.html` 能正常打开，6 个页面都能切换，路线图正常显示
- [ ] D9（2/3 周三）的美食区里，水谷茶屋显示「今天休息」
- [ ] 改一下系统日期（或在代码里临时 mock 今天为 2027-02-05），确认会自动跳到 D11 并高亮
- [ ] 勾选、记账、汇率刷新页面后还在
- [ ] 预算合计是代码算出来的，和 JSON 一致
- [ ] 浏览器控制台没有报错
- [ ] 用 375px 宽度检查，没有横向滚动条

做完后，在回复里列出：完成了哪些、没完成哪些、需要人来决定的问题。
