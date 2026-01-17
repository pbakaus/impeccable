# Impeccable

你一直在寻找的设计词汇。1 个技能，17 个命令，以及精心整理的反模式，助你打造出色的前端设计。

> **快速开始：** 访问 [impeccable.style](https://impeccable.style) 下载即用包。

## 为什么选择 Impeccable？

Anthropic 创建了 [frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design) 技能，引导 Claude 做出更好的 UI 设计。Impeccable 在此基础上增加了更深入的专业知识和更强的控制力。

所有大语言模型都学习过相同的通用模板。如果没有指导，你会得到同样的可预测错误：Inter 字体、紫色渐变、卡片嵌套卡片、彩色背景上的灰色文字。

Impeccable 通过以下方式对抗这种偏见：

- **扩展的技能**：包含 7 个领域特定的参考文件（[查看源码](source/skills/frontend-design/)）
- **17 个引导命令**：用于审核、审查、抛光、简化、动画等
- **精心整理的反模式**：明确告诉 AI 什么是 **不应该** 做的

## 包含内容

### 技能：frontend-design

一个综合性的设计技能，包含 7 个领域特定的参考文件（[查看技能](source/skills/frontend-design/SKILL.md)）：

| 参考文件                                                                            | 覆盖范围                            |
|-------------------------------------------------------------------------------------|-------------------------------------|
| [typography](source/skills/frontend-design/reference/typography.md)                 | 字体系统、字体搭配、模数比例、OpenType |
| [color-and-contrast](source/skills/frontend-design/reference/color-and-contrast.md) | OKLCH、淡色调中性色、深色模式、无障碍  |
| [spatial-design](source/skills/frontend-design/reference/spatial-design.md)         | 间距系统、网格、视觉层次              |
| [motion-design](source/skills/frontend-design/reference/motion-design.md)           | 缓动曲线、错开动画、减少动画          |
| [interaction-design](source/skills/frontend-design/reference/interaction-design.md) | 表单、焦点状态、加载模式              |
| [responsive-design](source/skills/frontend-design/reference/responsive-design.md)   | 移动优先、流式设计、容器查询          |
| [ux-writing](source/skills/frontend-design/reference/ux-writing.md)                 | 按钮标签、错误消息、空状态            |

### 17 个命令

| 命令                | 功能                                 |
|---------------------|--------------------------------------|
| `/teach-impeccable` | 一次性设置：收集设计上下文，保存到配置 |
| `/audit`            | 运行技术质量检查（无障碍、性能、响应式） |
| `/critique`         | UX 设计审查：层次、清晰度、情感共鸣     |
| `/normalize`        | 与设计系统标准对齐                   |
| `/polish`           | 交付前的最终润色                     |
| `/simplify`         | 剥离到本质                           |
| `/clarify`          | 改进不清晰的 UX 文案                 |
| `/optimize`         | 性能优化                             |
| `/harden`           | 错误处理、i18n、边缘情况               |
| `/animate`          | 添加有意义的动画                     |
| `/colorize`         | 引入战略性色彩                       |
| `/bolder`           | 增强单调的设计                       |
| `/quieter`          | 降低过于大胆的设计                   |
| `/delight`          | 添加令人愉悦的瞬间                   |
| `/extract`          | 提取为可复用组件                     |
| `/adapt`            | 适配不同设备                         |
| `/onboard`          | 设计引导流程                         |

### 反模式

该技能包含明确的指导，告诉 AI 应该避免什么：

- 不要使用过度使用的字体（Arial、Inter、系统默认）
- 不要在彩色背景上使用灰色文字
- 不要使用纯黑/灰色（始终添加色调）
- 不要把所有东西都包裹在卡片中，也不要卡片嵌套卡片
- 不要使用弹跳/弹性缓动（感觉过时）

## 实际案例

访问 [impeccable.style](https://impeccable.style#casestudies) 查看真实项目的使用 Impeccable 命令前后的案例对比。

## 安装

### 方式一：从网站下载（推荐）

访问 [impeccable.style](https://impeccable.style)，为你的工具下载 ZIP 包，然后解压到你的项目中。

### 方式二：从仓库复制

**Cursor：**
```bash
cp -r dist/cursor/.cursor your-project/
```

> **注意：** Cursor 技能需要设置：
> 1. 在 Cursor 设置 → Beta 中切换到 Nightly 频道
> 2. 在 Cursor 设置 → Rules 中启用 Agent Skills
>
> [了解更多关于 Cursor 技能](https://cursor.com/docs/context/skills)

**Claude Code：**
```bash
# 项目级
cp -r dist/claude-code/.claude your-project/

# 或全局（应用于所有项目）
cp -r dist/claude-code/.claude/* ~/.claude/
```

**Gemini CLI：**
```bash
cp -r dist/gemini/.gemini your-project/
```

> **注意：** Gemini CLI 技能需要设置：
> 1. 安装预览版本：`npm i -g @google/gemini-cli@preview`
> 2. 运行 `/settings` 并启用 "Skills"
> 3. 运行 `/skills list` 验证安装
>
> [了解更多关于 Gemini CLI 技能](https://geminicli.com/docs/cli/skills/)

**Codex CLI：**
```bash
cp -r dist/codex/.codex/* ~/.codex/
```

## 使用方法

安装后，在你的 AI 编程工具中使用命令：

```
/audit           # 查找问题
/normalize       # 修复不一致
/polish          # 最终清理
/simplify        # 移除复杂性
```

大多数命令接受可选参数来聚焦特定区域：

```
/audit header
/polish checkout-form
```

**注意：** Codex CLI 使用不同的语法：`/prompts:audit`、`/prompts:polish` 等。

## 支持的工具

- [Cursor](https://cursor.com)
- [Claude Code](https://claude.ai/code)
- [Gemini CLI](https://github.com/google-gemini/gemini-cli)
- [Codex CLI](https://github.com/openai/codex)

## 贡献

查看 [DEVELOP.md](DEVELOP.md) 了解贡献者指南和构建说明。

## 许可证

Apache 2.0。查看 [LICENSE](LICENSE)。

frontend-design 技能基于 [Anthropic 的原始版本](https://github.com/anthropics/skills/tree/main/skills/frontend-design)。查看 [NOTICE.md](NOTICE.md) 了解署名信息。

---

由 [Paul Bakaus](https://www.paulbakaus.com) 创建
