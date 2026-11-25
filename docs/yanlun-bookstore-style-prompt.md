# 研论书屋 · 森林玻璃工作台样式提示词模板

> 样式快照：2026-11-25
> 适用页面：项目工作台首页（研究项目列表）
> 默认验收主题：深色；同时保留系统浅色适配
> 来源：当前页面截图、`sites/web/index.html`、`sites/web/assets/study.css`、`sites/web/assets/study.js`

## 使用方式

1. 将本文件整体复制给编码 Agent。
2. 替换文中的 `{{变量}}`；不需要替换的内容可直接使用默认示例。
3. 源素材路径相对于本文件列出。跨项目复用时，把素材复制到目标项目的本地静态目录，或生成同构透明素材，不要使用外链。
4. 如果只复用一个组件，保留“设计令牌”和对应组件规则，不要把整页装饰强行加到所有页面。

---

# 角色

你是一名熟悉中文产品界面、CSS 布局、玻璃材质与无障碍实践的前端设计工程师。请把以下要求作为实现与验收的硬约束，而不是仅供参考的情绪板。

# 任务

实现「{{产品名，默认：研论书屋}}」的「{{页面标题，默认：研究项目}}」工作台首页。视觉目标是：

> 深色森林里的研究书桌：学术、安静、可信，带少量水晶折射和植物装饰；不是赛博朋克、游戏大厅或通用 SaaS 后台。

默认展示内容：

- 顶栏：展开研究库 / 研论书屋 / 研究证据工作台 / 本机保存。
- 侧栏：研究库 / 全部项目 / 演示项目 · 增强开关归因。
- 页头：工作台 / 研究项目 / 把论文读成可检验的主张：每条结论，都要有对照证据。
- 统计：1 项目 / 0 研究问题 / 1 近 7 天更新。
- 工具条：搜索项目 / 导入 PDF / 新建项目 / 模型服务。
- 列表头：最近更新 / 1 个项目。
- 项目卡：未分类 / 演示项目 · 增强开关归因 / 研究问题 0 / 11-25 08:17 / 置顶、重命名、删除。

# 实现边界

- 不新增第三方依赖，不引入在线字体、图标库或远程图片。
- 图标使用内联 SVG，统一 18px、`stroke-width: 1.8–2`、圆角端点与连接。
- 默认只调整界面与样式，不改变既有数据结构、路由、存储、模型调用和业务契约。
- 不把玻璃效果做成高饱和霓虹渐变，不使用纯黑纯白大面积铺底，不使用厚重卡片阴影。
- 装饰元素必须 `pointer-events: none`、`user-select: none`，不能遮挡文字、按钮、链接或侧栏拖动。
- 保留语义化 HTML、键盘操作、焦点样式和 `aria-*`；不能只做一个静态截图壳。

# 设计令牌

## 1. 字体

```css
--font-ui: "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC",
  "Source Han Sans SC", system-ui, -apple-system, "Segoe UI", sans-serif;
--font-read: "Songti SC", "Source Han Serif SC", "Noto Serif CJK SC",
  "SimSun", "STSong", Georgia, serif;
--font-mono: ui-monospace, "Cascadia Mono", Consolas, monospace;
```

- 界面、按钮、输入框、元信息使用无衬线字体。
- 品牌名、页面主标题、空态标题使用中文衬线字体。

## 2. 深色主题（截图主视觉）

```css
:root {
  color-scheme: dark;
  --bg-app: #12140f;
  --bg: #191c15;
  --surface: #1e2119;
  --surface-2: #24281f;
  --sheet: #24281e;
  --ink: #ece8da;
  --ink-2: #b2b7a7;
  --meta-ink: #8f9584;
  --line: #30352a;
  --line-strong: #414737;
  --brand: #8ac7a6;
  --brand-deep: #a3d8ba;
  --brand-ink: #0e1a13;
  --brand-soft: #223029;
  --danger: #e08777;
  --danger-deep: #eda093;
  --amber: #d9ab6a;
  --amber-line: #a9843f;
  --measured-bg: #1f2f26;
  --tag-bg: #24281f;
  --overlay: rgba(5, 8, 5, 0.62);
  --shadow: rgba(0, 0, 0, 0.55);
  --shadow-soft: rgba(0, 0, 0, 0.35);
  --botanical: #8aab8d;
  --paper-grain: rgba(220, 238, 218, 0.035);

  --glass-bg: rgba(24, 30, 24, 0.68);
  --glass-bg-strong: rgba(31, 38, 30, 0.88);
  --glass-control: rgba(255, 255, 255, 0.035);
  --glass-control-hover: rgba(255, 255, 255, 0.075);
  --glass-line: rgba(179, 220, 192, 0.16);
  --glass-line-strong: rgba(154, 217, 179, 0.42);
  --glass-highlight: rgba(235, 255, 242, 0.16);
  --glass-glint: rgba(151, 226, 184, 0.14);
  --glass-shadow: rgba(0, 0, 0, 0.34);
  --glass-focus: rgba(138, 199, 166, 0.16);

  --r-sm: 4px;
  --r-md: 8px;
  --r-lg: 12px;
  --control-radius: 10px;
}
```

## 3. 浅色主题回退

```css
@media (prefers-color-scheme: light) {
  :root {
    color-scheme: light;
    --bg-app: #f5f2e9;
    --bg: #efece2;
    --surface: #fffdf8;
    --surface-2: #f8f5ec;
    --sheet: #fffefa;
    --ink: #1e231d;
    --ink-2: #575e54;
    --meta-ink: #6c7268;
    --line: #e2ddce;
    --line-strong: #cfc8b5;
    --brand: #1f5a45;
    --brand-deep: #174432;
    --brand-ink: #ffffff;
    --brand-soft: #e6efe8;
    --danger: #9e3b2e;
    --danger-deep: #7c2d23;
    --amber: #82551c;
    --amber-line: #b58a2b;
    --measured-bg: #eaf2ea;
    --tag-bg: #f1ede1;
    --overlay: rgba(30, 35, 29, 0.38);
    --shadow: rgba(35, 41, 33, 0.14);
    --shadow-soft: rgba(35, 41, 33, 0.07);
    --botanical: #4f7058;
    --paper-grain: rgba(67, 83, 58, 0.04);

    --glass-bg: color-mix(in srgb, var(--surface) 76%, transparent);
    --glass-bg-strong: color-mix(in srgb, var(--surface) 92%, transparent);
    --glass-control: color-mix(in srgb, var(--surface) 58%, transparent);
    --glass-control-hover: color-mix(in srgb, var(--surface) 88%, transparent);
    --glass-line: color-mix(in srgb, var(--line-strong) 52%, transparent);
    --glass-line-strong: color-mix(in srgb, var(--brand) 38%, var(--line-strong));
    --glass-highlight: rgba(255, 255, 255, 0.7);
    --glass-glint: rgba(188, 255, 222, 0.32);
    --glass-shadow: rgba(35, 41, 33, 0.12);
    --glass-focus: color-mix(in srgb, var(--brand) 18%, transparent);
  }
}
```

## 4. 尺度与圆角

- 基础间距节奏：4 / 8 / 12 / 16 / 24 / 32 / 48 / 64px；页面级留白使用 36px 与 72px。
- 顶栏高度：56px。
- 默认侧栏宽度：248px；允许拖动范围 208–420px。
- 主内容：`padding: 36px 48px 64px`，`max-width: 1240px`，水平居中。
- 工具条：18px 圆角；搜索与工具条按钮：11px；项目卡：20px。
- 标签、操作胶囊、进度条：999px 胶囊圆角。
- 全站原生下拉框：10px 圆角，箭头与焦点使用松绿主题色。

# 页面骨架

```html
<body>
  <a class="skip-link" href="#main">跳到主要内容</a>

  <header class="topbar">
    <div class="topbar-left">
      <button class="nav-btn" aria-label="展开研究库" aria-expanded="false">
        <!-- 面板图标 + 展开研究库 -->
      </button>
      <a class="brand" href="#/">研论书屋</a>
      <span class="brand-sub">研究证据工作台</span>
    </div>
    <button class="save-mode" aria-expanded="false">本机保存</button>
  </header>

  <div class="shell">
    <aside class="sidebar" aria-label="研究导航">
      <div class="sidebar-heading">
        <span class="sidebar-feather-mark" aria-hidden="true"><!-- 透明羽毛 --></span>
        <p class="sidebar-label">研究库</p>
      </div>
      <nav class="side-nav"><!-- 全部项目 + 项目树 --></nav>
      <div class="sidebar-resizer" role="separator" aria-orientation="vertical">
        <img class="sidebar-tree-image" alt="" draggable="false">
      </div>
    </aside>

    <main class="content" id="main" tabindex="-1">
      <header class="workbench-head">
        <div class="workbench-title">
          <p class="eyebrow">工作台</p>
          <h1>研究项目</h1>
          <p class="lede">把论文读成可检验的主张：每条结论，都要有对照证据。</p>
          <div class="stat-row"><!-- 三组统计 --></div>
        </div>
        <div class="workbench-tools" role="group" aria-label="项目搜索与工作台操作">
          <div class="search-box workbench-search">
            <!-- 搜索图标 + input -->
          </div>
          <div class="head-actions workbench-actions" role="group" aria-label="工作台操作">
            <button class="btn btn-primary">导入 PDF</button>
            <button class="btn btn-new-project">新建项目</button>
            <button class="btn btn-quiet">模型服务</button>
          </div>
        </div>
      </header>

      <div class="workbench-list-head">
        <h2 class="section-title">最近更新</h2>
        <p class="list-count">1 个项目</p>
      </div>

      <div class="project-grid">
        <article class="project-card">
          <img class="card-feather" alt="" aria-hidden="true" draggable="false">
          <div class="card-top"><span class="card-tag">未分类</span></div>
          <div class="card-body">
            <a class="card-name" href="#/project/demo">演示项目 · 增强开关归因</a>
            <div class="card-meta">
              <span>研究问题 0</span>
              <span>11-25 08:17</span>
            </div>
          </div>
          <div class="card-footer">
            <div class="card-progress" role="img" aria-label="研究问题 0 个，其中待补跑 0 个">
              <div class="card-progress-bar"></div>
            </div>
            <div class="card-actions">
              <button class="card-action" aria-label="置顶项目" aria-pressed="false"><!-- pin --></button>
              <button class="card-action" aria-label="重命名项目"><!-- edit --></button>
              <button class="card-action card-action--danger" aria-label="删除项目"><!-- trash --></button>
            </div>
          </div>
        </article>
      </div>
    </main>
  </div>
</body>
```

# 组件规则

## 1. 顶栏

- `position: sticky; top: 0; z-index: 30; height: 56px`。
- 水平内边距 32px，背景 `var(--surface)`，底部 1px `var(--line)`。
- 左侧元素间距 12px；品牌名字体 22px / 700 / 衬线 / `letter-spacing: .06em`。
- 副标题 12px / `letter-spacing: .12em`，左侧用 1px 竖线分隔。
- “本机保存”为无重边框的文字按钮，13px；前面有 6px 松绿圆点和 3px 柔光环。
- “展开研究库”按钮最小高度 40px、12px 水平内边距、6px 圆角、18px 图标。
- ≤767px：顶栏内边距 16px，隐藏副标题；导航按钮为 44×44px；≤360px 缩小品牌与间距。

## 2. 森林侧栏

- 使用 `grid-template-columns: var(--sidebar-width) minmax(0, 1fr)`，默认 `--sidebar-width: 248px`。
- 侧栏基础内边距 26px 18px；导航项间距 8px，当前项用 `var(--surface)` 与品牌色图标。
- “研究库”为 11px、字距 .18em；前方 15px 透明羽毛标记。
- 桌面有项目时，侧栏覆盖在森林底图上，使用从左向右淡出的遮罩；不要画明显右边框。
- 树木贴图宽 144px、`object-fit: cover`，跨越侧栏分界；拖动命中区宽 136px、位于分界中央。
- 不添加可见的拖动竖线、粗把手或悬停高亮条。
- ≥1200px 且主内容有项目网格时，主内容增加 72px 左内边距，给树木留出空间。
- 桌面收起侧栏时，网格轨道与侧栏宽度归零；≤1199px 使用 260px 抽屉并隐藏拖动条；Escape 关闭后回焦。

## 3. 主内容与页头

- 主内容为纵向 flex，子项间距 28px；移动端改为 16px。
- 页头左右布局，`align-items: center; gap: 24px; padding-bottom: 20px`，不保留传统标题下划线。
- 眉题“工作台”为 11px / 字距 .18em / 品牌色，前方追加 15×9px 叶片形标记，旋转 -24deg。
- 主标题 34px / 1.2 / 600 / 中文衬线；移动端 28px。
- 副标题 15px / 1.75 / `var(--ink-2)`，最大宽度 46ch。
- 统计组间距 22px；数值 22px / 600 / 品牌色 / 等宽数字；标签 12px / `var(--meta-ink)`。
- 统计组之间用 24px 间隔与 1px 分隔线；移动端缩小为 16px。

## 4. 水晶工具条

- 容器：`display: flex; align-items: center; gap: 8px; padding: 7px`。
- 18px 圆角、1px 玻璃描边、双层内高光、`0 12px 30px` 柔和环境阴影。
- 背景为左上径向松绿高光 + 135deg 半透明渐变；`backdrop-filter: blur(18px) saturate(135%)`。
- 增加一条 115deg 斜向轻扫高光，默认位于左侧，悬停缓慢向右移动；不能持续自动闪烁。
- 搜索框桌面宽 260px、最小 190px、高 38px、11px 圆角；1200–1359px 宽 220px、最小 170px。
- 搜索框默认无重边框，悬停才出现玻璃底与细描边；聚焦使用 3px 松绿焦点环。
- 三个操作按钮统一高 38px、11px 圆角、13px 字号、6px 图标间距。
- 仅“导入 PDF”使用实心松绿主按钮；“新建项目”“模型服务”使用玻璃次级按钮。
- ≤1199px：页头改纵向，工具条占满整行，搜索自适应剩余宽度。
- ≤640px：工具条改单列 grid；搜索独占一行，三个按钮等宽第二行；搜索与按钮高度 44px。
- ≤380px：按钮图标缩到 14px，继续压缩水平内边距，不截断文案。

## 5. 最近更新列表头

- 与项目网格间距紧凑，使用 `margin-top: -4px`。
- 标题 14px / 600 / 字距 .08em；后方横线从玻璃描边渐变到透明。
- 右侧数量为 12px 胶囊，例如“1 个项目”，使用玻璃底与细描边。
- 空项目时隐藏搜索框、列表头和数量，不要留下空白占位。

## 6. 虹彩毛玻璃项目卡

- ≥1024px 使用 `grid-template-columns: repeat(2, minmax(0, 1fr))`；≤767px 单列。
- 网格间距 20px，移动端 14px。
- 卡片最小高度 220px、内边距 24px、20px 圆角、`overflow: hidden`、独立层叠上下文。
- 背景由两层松绿/薰衣草紫/香槟金径向环境光与半透明线性玻璃底组成。
- `backdrop-filter: blur(20px) saturate(145%)`，配双层内高光与低透明度环境阴影。
- 卡片斜向高光默认偏左，悬停缓慢扫过；只作为材质，不遮挡内容。
- 分类标签为胶囊，3px 9px 内边距、细描边、8px 模糊；可带小状态点。
- 标题 21px / 1.45 / 600 / 字距 -.015em；移动端 18px。
- 元信息 12px / `var(--meta-ink)`，字段之间使用小圆点分隔；待补跑使用琥珀色。
- 底部进度为 3px 细线，不使用粗进度条；颜色从品牌绿过渡到当前卡片辅色。
- 右上角透明羽毛桌面 74×74px、移动端 60×60px，`object-fit: contain`，带轻微角度、柔和投影和光晕。
- 羽毛位置、尺度、角度与光晕按项目 ID 稳定生成，搜索重绘时不能跳动。可使用以下色板：
  - `#79b995 / #b7a6e8 / #e6c88f`
  - `#78c5bd / #8fb4e5 / #e4b4c7`
  - `#d2ad72 / #ca9fb6 / #9dc3a7`
  - `#8ac7a6 / #77b7c9 / #c5b5e6`
- 稳定参数范围：x 12–23px、y 10–21px、scale .90–1.04、rotate -4–4deg、光晕 x 22–87%、y 12–49%。
- 卡片悬停上移 4px，边框、阴影、轻扫高光与羽毛光晕同步增强；仅桌面精确指针启用。
- 焦点落在卡片内任何控件时显示 3px 松绿焦点环。
- 置顶/重命名/删除按钮必须常显，收进底部右侧胶囊操作区；桌面按钮 30×30px，移动端 28px，≤380px 26px。
- 整卡标题链接可点击，但操作按钮必须位于其上层，不能出现点击穿透或相互遮挡。

## 7. 空态（如有项目为空）

- 使用与项目卡相同的玻璃令牌、20px 圆角、20px 模糊与饱和度。
- 标题“从一篇论文开始”，使用中文衬线字体；三步说明使用细线分隔。
- 主按钮“导入 PDF”，次按钮“载入演示项目”使用玻璃按钮。
- 右侧放透明羽毛笔与松绿光晕；移动端降为右上角低透明度淡出装饰，不能压住正文。

# 森林背景与素材

## 必需素材

| 素材 | 用途 | 当前源路径 |
| --- | --- | --- |
| 森林书桌底图 | 有项目时覆盖整个 shell，侧栏与主区连续 | `../sites/web/assets/forest-project-backdrop.webp` |
| 蜿蜒树木 | 侧栏分界的跨边界装饰 | `../sites/web/assets/sidebar-winding-tree.png` |
| 透明羽毛 | 侧栏小标记与项目卡右上装饰 | `../sites/web/assets/sidebar-feather.png` |
| 植物枝叶 | 页面左上/左下角弱装饰 | `../sites/web/assets/forest-sprig.svg` |
| 羽毛笔 | 空态右侧插画 | `../sites/web/assets/forest-quill.svg` |
| 银杏叶（可选） | 侧栏拖动时的短时落叶 | `../sites/web/assets/sidebar-leaf.png` |

## 背景规则

- `body` 叠加多个低透明度松绿与薰衣草紫径向渐变，最终落在 `var(--bg-app)`。
- 仅当存在 `.project-grid` 时显示森林底图：`position: absolute; inset: 0`，覆盖整个 `.shell`，`background-size: cover`。
- 深色底图不透明度 .46，浅色 .14，移动端 .28。
- 底图增加纵向遮罩：顶部透明、12% 时 .12、34% 后完全显示、82% 后渐隐、底部透明。
- 主内容层位于底图之上；桌面有项目时侧栏再位于主内容之上。
- 角落枝叶使用 SVG mask，不直接铺一张不透明图片；左上/左下固定、低透明度、无交互。
- 禁止用装饰素材替换正文对比度，也不允许为了“有森林感”把图片不透明度调到刺眼程度。

# 响应式规格

| 视口宽度 | 预期布局 |
| --- | --- |
| ≥1360px | 标题与水晶工具条同级；搜索宽 260px；项目卡两列 |
| 1200–1359px | 工具条仍同级；搜索宽 220px；按钮略紧凑；项目卡两列 |
| 1024–1199px | 页头纵向；工具条整行；项目卡两列；侧栏为 260px 抽屉 |
| 768–1023px | 工具条整行；项目卡单列；主内容左右内边距 28px |
| ≤767px | 顶栏 56px；主内容 16px 内边距；隐藏品牌副标题；项目卡单列；导航按钮 44px |
| ≤640px | 工具条搜索与三钮分行；三钮等宽；触控高度 44px |
| ≤380px | 卡片内边距 16px；操作钮 26px；工具条图标 14px；顶栏进一步压缩 |

# 交互与无障碍

- 所有页面宽度下不得出现横向滚动；长项目名必须换行或省略，不能撑破卡片。
- 搜索框可直接点击或使用 Tab 聚焦；Escape 清空搜索内容；搜索高亮使用松绿半透明底色。
- 搜索、筛选、置顶、重命名、删除、导入、新建与模型服务沿用既有业务行为。
- 焦点顺序符合视觉顺序；弹窗打开后聚焦首个字段，Escape 关闭并回焦触发器。
- 图标按钮提供可读 `aria-label` 与 `title`；装饰图片 `alt=""`、`aria-hidden="true"`。
- 不能只用颜色表达状态；置顶状态同时使用 `aria-pressed`，进度同时提供文本说明。
- 至少覆盖以下状态：默认、悬停、键盘焦点、按下、禁用、空数据、搜索无结果。
- `prefers-reduced-motion: reduce`：关闭位移、轻扫与落叶动画。
- `prefers-reduced-transparency: reduce`：移除背景模糊与高光，改为实色表面，保留层级与边框。
- `prefers-contrast: more`：提高边框与表面对比，降低羽毛干扰。
- `forced-colors: active`：使用 Canvas/CanvasText，隐藏背景图、羽毛与高光。
- 打印时隐藏森林背景、植物和羽毛笔，恢复白底黑字。

# 动效节奏

- 普通按钮颜色与背景：140–160ms ease。
- 卡片悬停位移：220ms `cubic-bezier(.23, 1, .32, 1)`。
- 卡片轻扫高光：520ms；工具条轻扫：700ms。
- 羽毛反馈：320ms；按下缩放约 .94–.98。
- 侧栏落叶（可选）：1100ms，最多同时 12 片，不持续无限播放。
- 不要添加无意义的循环漂浮、闪烁、粒子或自动视差。

# 验收清单

- [ ] 1440×900 深色首屏与参考图结构一致：56px 顶栏、248px 侧栏、左侧森林分界、右侧工具条、两列卡片区域。
- [ ] 深色令牌与截图一致，正文与元信息清晰可读，没有纯黑纯白大色块。
- [ ] 工具条、卡片、标签、操作区均呈现真实玻璃折射、内高光与环境阴影，而非普通半透明色块。
- [ ] 只有“导入 PDF”是实心主操作，按钮层级明确。
- [ ] 项目卡操作区默认可见，按钮命中准确，不与整卡链接冲突。
- [ ] 1440 / 1280 / 1024 / 768 / 640 / 390 / 320px 均无页面横向溢出。
- [ ] ≥1024px 两列、≤767px 单列；≤640px 工具条内部正确分行。
- [ ] 移动端主要触控目标达到 44×44px；卡片装饰不压住标题与操作。
- [ ] 浅色主题、悬停、焦点、按下、禁用、空态、搜索无结果均完成检查。
- [ ] 减少动效、减少透明度、高对比与强制颜色模式均有可用降级。
- [ ] 控制台无 error/warn；所有图片从本地加载，无失败请求。
- [ ] 未修改业务 schema、依赖、模型调用和存储契约。

# 输出要求

完成后简要报告：

1. 新增或修改的文件。
2. 设计令牌、布局、组件与素材的落地位置。
3. 实际执行的验收命令、浏览器尺寸与退出码。
4. 未验证或受限的项目；不要声称执行过未进行的视觉测试。
5. 明确说明本次没有改动哪些业务范围。
