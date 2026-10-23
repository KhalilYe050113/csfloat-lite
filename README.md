# CSFloat Lite

在 Steam 社区市场页面直接显示 CS2 物品的**浮点值（Float）**、**涂装种子（Paint Seed）**和**磨损等级**，
外加印花 / 挂件缩略图、浮点排序、条件筛选。

**纯本地解析 inspect 数据：零网络请求、零授权、零依赖，单文件 92KB。**

> 受 [CSFloat Market Checker](https://github.com/csfloat/extension) 启发，只实现了其中
> **不依赖它服务器**的那一部分。与 CSFloat 官方无隶属关系。

<!-- 有截图后在这里插入：
![市场页](screenshots/market.png)
-->

## 特性

| 功能 | 说明 |
|---|---|
| 浮点值 | 14 位精度，与官方解析器逐字段对拍验证 |
| 磨损条 | 0–1 全区间色带 + 当前位置游标，悬停显示磨损等级 |
| 涂装种子 | 直接显示 Pattern Seed |
| StatTrak / 纪念品 | `ST` / `SV` 标记 |
| 印花 / 挂件 | 64×48 缩略图排在物品名右侧一行，悬停放大并显示名称，下方标磨损百分比 / 图案编号 |
| 快捷检视 | 鼠标移到物品图上出现 🔍，点击直接唤起游戏检视 |
| 排序 | 按浮点升 / 降序、还原原序（记住选择） |
| 每页数量 | 10 / 25 / 50 / 100 切换（记住选择） |
| 筛选器 | `float <= 0.25`、`0.20 <= float and float <= 0.23`、`price <= 120` 等，命中行整行染色 |
| 新旧市场 | 同时支持旧版 DOM 页面与新版 React 市场 |

## 安装

1. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/)（或 Violentmonkey）
2. 打开这个链接直接安装：

   ```
   https://raw.githubusercontent.com/KhalilYee050113/csfloat-lite/main/csfloat-lite.user.js
   ```

   或手动：Tampermonkey 面板 → 新建脚本 → 粘贴全文 → 保存
3. 打开任意 `https://steamcommunity.com/market/listings/730/*` 页面

> 脚本的 `@namespace` 是 `csfloat-lite`。如果你之前手动装过同名脚本，从上面链接安装会
> **更新**那一份，而不是并排装出两个（两个同时注入会导致内容重复）。

## 使用

页面加载后每行的物品名下方会出现浮点块，市场列表顶部多出一行工具条：

```
CSFloat Lite v1.7.6   浮点 ↑   浮点 ↓   原序   100 / 页   已解析 48/48   诊断
┌ 色板 ─ 表达式输入框 ─ ✓/✗ ─ 添加
└ 条件 chip
```

**筛选器语法**：变量 + 比较符 + `and / or / not` + 括号，不支持函数。

```text
float <= 0.25
0.20 <= float and float <= 0.23
float >= 0.54 or price <= 100
phase == "Ruby"
seed == 306
```

变量：`float` `seed` `price` `pattern` `phase` `minwearfloat` `maxwearfloat`。
价格取页面显示价，兼容 `¥ 1,000.00`、`$12.34`、`1.234,56€`。

**诊断**：页面结构变化导致解析不出来时，点工具条上的「诊断」，控制台会打印
`mode`（react / legacy）、行状态统计、首个挂单的属性结构，粘给作者即可定位。

## 为什么不需要网络

Steam 市场页已经把每件物品的 inspect 数据放在页面里了（旧版在 `g_rgAssets`，新版在 React props）。
那串十六进制是 protobuf：`0x00` + 载荷 + CRC32，字段 7 是浮点、字段 8 是种子。
解码、磨损分级、多普勒相位全部在本地算完，所以**断网也能用**。

反直觉的一点：字段 7 在 proto 里声明成 `uint32`，实际装的是 **float32 的位模式**
（`1059207035` = `0.6336`），按整数读会得到垃圾值。

没做的部分（排名、价格历史、蓝宝石、Fade 百分比）都需要请求 CSFloat 的接口，
而那些接口只对官方扩展 ID 开放 CORS 白名单——所以这个脚本没有它们。

## 已知限制

- 只处理**市场挂单页**，库存页与报价页未实现
- 浮点条固定 0–1 全区间，没有按每把枪的真实 `min/max` 收窄（那需要 schema，得联网）
- 新版 React 市场**不提供排序与每页数量**：该页由 React 管理 DOM，重排会被下一次渲染覆盖
  （官方扩展同样只在旧版提供工具条）
- 印花的跳转在中文站点指向**市场搜索页**而不是物品页：物品页要求 `market_hash_name`
  逐字相同，而描述里给的是展示名，差一个字就会落到「此物品不在货架上」（官方也是同样的处理）
- Steam 改版可能让选择器失效，届时用「诊断」定位

## 调字号与间距

样式参数集中在脚本第 63 行起的 `.cfl-block{}` 里：

```css
--cfl-fs:14px;      /* 两行文字的字号 */
--cfl-lh:1.45;      /* 行高（倍数） */
--cfl-bar-w:170px;  /* 磨损条宽度 */
--cfl-bar-h:6px;    /* 磨损条高度 */
--cfl-bar-mt:5px;   /* 条与上方物品名的距离 */
--cfl-bar-mb:5px;   /* 条与 Float 行的距离 */
```

调的时候不用改文件，控制台一行就生效（刷新复原）：

```js
__csfloatLite.tune({fontSize: 13})
__csfloatLite.tune({barTop: 8, barGap: 6})
__csfloatLite.tune({barWidth: 200, barHeight: 8})
```

调到满意后把数值写回上面那几个变量即可固化。

## 验证方式

不是"看起来对"，是跟官方解析器对拍：

- **解码**：随机 300 件物品逐字段比对，542 项断言（含 XOR 掩码变体、6 种链接形态、CRC 篡改检测）
- **页面注入**：模拟旧版 / 新版 React / 极端 DOM 结构，128 项断言
- **真实样本**：用实际挂单的 hex（Galil AR | Eco，float 0.5360337495803833 / seed 34）回归

## 许可

MIT。见 [LICENSE](LICENSE)。

本项目包含对 [csfloat/extension](https://github.com/csfloat/extension)（MIT，Copyright (c) 2026 CSFloat Inc.）
部分逻辑的移植，包括印花 / 挂件的解析与渲染、快捷检视入口、市场模式判定。
原版权声明已保留在 LICENSE 中。

## 免责声明

非官方项目，与 Valve、Steam、CSFloat 均无隶属关系。
脚本只读取当前页面已有的数据并在本地渲染，不修改页面提交的任何内容、不发起额外请求。
使用风险自负。
