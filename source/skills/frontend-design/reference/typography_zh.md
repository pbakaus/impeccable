# 排版

## 经典排版原则

### 垂直韵律

你的行高应该是所有垂直间距的基础单位。如果正文有 `line-height: 1.5` 在 `16px` 类型上 (= 24px)，间距值应该是24px的倍数。这创造下意识和谐——文本和空间共享数学基础。

### 模块化规模和层次

常见错误：太多字体大小太接近（14px、15px、16px、18px...）。这创造泥泞层次。

**使用更少大小更有对比。** 5大小系统覆盖大多数需求：

| 角色 | 典型比例 | 用例 |
|------|----------|------|
| xs | 0.75rem | 标题、法律 |
| sm | 0.875rem | 次要UI、元数据 |
| base | 1rem | 正文 |
| lg | 1.25-1.5rem | 子标题、引导文本 |
| xl+ | 2-4rem | 标题、英雄文本 |

流行比例：1.25（大三度）、1.333（完美四度）、1.5（完美五度）。选择一个并坚持。

### 可读性和测量

对基于字符的测量使用 `ch` 单位（`max-width: 65ch`）。行高与行长成反比——窄列需要更紧的行距，宽列需要更多。

**非明显**：在暗背景上增加行高轻文本。感知权重更轻，所以文本需要更多呼吸空间。正常行高增加0.05-0.1。

## 字体选择和配对

### 选择独特字体

**避免不可见的默认**：Inter、Roboto、Open Sans、Lato、Montserrat。这些到处都是，使你的设计感觉通用。对于文档或工具个性不是目标的，它们很好——但如果你想要独特设计，看别处。

**更好Google Fonts替代**：
- Inter替代 → **Instrument Sans**、**Plus Jakarta Sans**、**Outfit**
- Roboto替代 → **Onest**、**Figtree**、**Urbanist**
- Open Sans替代 → **Source Sans 3**、**Nunito Sans**、**DM Sans**
- 编辑/高级感觉 → **Fraunces**、**Newsreader**、**Lora**

**系统字体被低估**：`-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui` 看起来原生、瞬间加载、高度可读。对于性能 > 个性化的应用考虑这个。

### 配对原则

**非明显真相**：你经常不需要第二个字体。一个精心选择的字体系列在多个权重中创造比两个竞争字体更干净的层次。只有当你需要真正对比时添加第二个字体（例如，显示标题 + 正文serif）。

配对时，在多个轴上对比：
- Serif + Sans（结构对比）
- 几何 + 人文主义（个性对比）
- 压缩显示 + 宽正文（比例对比）

**绝不配对相似但不相同的字体**（例如，两个几何sans-serif）。它们创造视觉张力而无清晰层次。

### 网页字体加载

布局偏移问题：字体晚加载，文本重排，用户看到内容跳跃。这是修复：

```css
/* 1. 对可见性使用 font-display: swap */
@font-face {
  font-family: 'CustomFont';
  src: url('font.woff2') format('woff2');
  font-display: swap;
}

/* 2. 匹配回退指标以最小化偏移 */
@font-face {
  font-family: 'CustomFont-Fallback';
  src: local('Arial');
  size-adjust: 105%;        /* 缩放匹配x高度 */
  ascent-override: 90%;     /* 匹配升部高度 */
  descent-override: 20%;    /* 匹配降部深度 */
  line-gap-override: 10%;   /* 匹配行间距 */
}

body {
  font-family: 'CustomFont', 'CustomFont-Fallback', sans-serif;
}
```

像[Fontaine](https://github.com/unjs/fontaine)这样的工具自动计算这些覆盖。

## 现代网页排版

### 流体类型

对流体排版使用 `clamp(min, preferred, max)`。中间值（例如，`5vw + 1rem`）控制缩放率——更高vw = 更快缩放。添加rem偏移所以它不会在小屏幕上崩溃到0。

**何时不使用流体类型**：按钮文本、标签、UI元素（应该是连续的）、非常短文本，或当你需要精确断点控制时。

### OpenType特性

大多数开发者不知道这些存在。使用它们抛光：

```css
/* 表格数字用于数据对齐 */
.data-table { font-variant-numeric: tabular-nums; }

/* 适当分数 */
.recipe-amount { font-variant-numeric: diagonal-fractions; }

/* 小写用于缩写 */
abbr { font-variant-caps: all-small-caps; }

/* 在代码中禁用连字 */
code { font-variant-ligatures: none; }

/* 启用字距（通常默认开启，但要明确） */
body { font-kerning: normal; }
```

在[Wakamai Fondue](https://wakamaifondue.com/)检查你的字体支持什么特性。

## 排版系统架构

语义命名令牌（`--text-body`、`--text-heading`），不是按值（`--font-size-16`）。在令牌系统中包含字体栈、大小规模、权重、行高和字母间距。

## 可访问性考虑

超越对比率（它们被很好记录），考虑：

- **绝不禁用缩放**：`user-scalable=no` 打破可访问性。如果你的布局在200%缩放时断开，修复布局。
- **对字体大小使用rem/em**：这尊重用户浏览器设置。绝不为正文 `px`。
- **最小16px正文**：比这小会伤害眼睛并在移动端失败WCAG。
- **充足触摸目标**：文本链接需要填充或行高创造44px+点击目标。

---

**避免**：每个项目超过2-3字体系列。跳过回退字体定义。忽略字体加载性能（FOUT/FOIT）。对正文使用装饰字体。