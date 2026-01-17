---
name: harden
description: 通过更好错误处理、i18n支持、文本溢出处理和边缘情况管理改进界面韧性。使界面稳健并生产就绪。
args:
  - name: target
    description: 要硬化的功能或区域（可选）
    required: false
---

加强界面对抗边缘情况、错误、国际化问题和打破理想化设计的现实使用场景。

## 评估硬化需求

识别弱点和边缘情况：

1. **用极端输入测试**：
   - 非常长的文本（名称、描述、标题）
   - 非常短的文本（空、单字符）
   - 特殊字符（表情符号、RTL文本、重音）
   - 大数字（百万、十亿）
   - 许多项目（1000+列表项目、50+选项）
   - 无数据（空状态）

2. **测试错误场景**：
   - 网络故障（离线、慢、超时）
   - API错误（400、401、403、404、500）
   - 验证错误
   - 权限错误
   - 速率限制
   - 并发操作

3. **测试国际化**：
   - 长翻译（德语通常比英语长30%）
   - RTL语言（阿拉伯语、希伯来语）
   - 字符集（中文、日语、韩语、表情符号）
   - 日期/时间格式
   - 数字格式（1,000 vs 1.000）
   - 货币符号

**关键**：只在完美数据下工作的设计不是生产就绪。对抗现实硬化。

## 硬化维度

系统地改进韧性：

### 文本溢出和换行

**长文本处理**：
```css
/* 单行省略号 */
.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 多行钳制 */
.line-clamp {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 允许换行 */
.wrap {
  word-wrap: break-word;
  overflow-wrap: break-word;
  hyphens: auto;
}
```

**Flex/Grid溢出**：
```css
/* 防止flex项目溢出 */
.flex-item {
  min-width: 0; /* 允许缩小低于内容大小 */
  overflow: hidden;
}

/* 防止grid项目溢出 */
.grid-item {
  min-width: 0;
  min-height: 0;
}
```

**响应式文本调整大小**：
- 使用`clamp()`流畅排版
- 设置最小可读大小（移动端14px）
- 测试文本缩放（放大到200%）
- 确保容器随文本扩展

### 国际化 (i18n)

**文本扩展**：
- 为翻译添加30-40%空间预算
- 使用适应内容的flexbox/grid
- 用最长语言测试（通常德语）
- 避免文本容器固定宽度

```jsx
// ❌ 坏：假设短英语文本
<button className="w-24">Submit</button>

// ✅ 好：适应内容
<button className="px-4 py-2">Submit</button>
```

**RTL（从右到左）支持**：
```css
/* 使用逻辑属性 */
margin-inline-start: 1rem; /* 不是margin-left */
padding-inline: 1rem; /* 不是padding-left/right */
border-inline-end: 1px solid; /* 不是border-right */

/* 或使用dir属性 */
[dir="rtl"] .arrow { transform: scaleX(-1); }
```

**字符集支持**：
- 处处使用UTF-8编码
- 用中文/日语/韩语(CJK)字符测试
- 用表情符号测试（它们可以是2-4字节）
- 处理不同脚本（拉丁、西里尔、阿拉伯等）

**日期/时间格式化**：
```javascript
// ✅ 使用Intl API正确格式化
new Intl.DateTimeFormat('en-US').format(date); // 1/15/2024
new Intl.DateTimeFormat('de-DE').format(date); // 15.1.2024

new Intl.NumberFormat('en-US', { 
  style: 'currency', 
  currency: 'USD' 
}).format(1234.56); // $1,234.56
```

**复数化**：
```javascript
// ❌ 坏：假设英语复数化
`${count} item${count !== 1 ? 's' : ''}`

// ✅ 好：使用适当i18n库
t('items', { count }) // 处理复杂复数规则
```

### 错误处理

**网络错误**：
- 显示清晰错误消息
- 提供重试按钮
- 解释发生了什么
- 提供离线模式（如果适用）
- 处理超时场景

```jsx
// 带恢复的错误状态
{error && (
  <ErrorMessage>
    <p>加载数据失败。 {error.message}</p>
    <button onClick={retry}>重试</button>
  </ErrorMessage>
)}
```

**表单验证错误**：
- 字段附近内联错误
- 清晰、具体消息
- 建议更正
- 不必要阻止提交
- 错误时保留用户输入

**API错误**：
- 适当处理每个状态码
  - 400：显示验证错误
  - 401：重定向到登录
  - 403：显示权限错误
  - 404：显示未找到状态
  - 429：显示速率限制消息
  - 500：显示通用错误，提供支持

**优雅降级**：
- 核心功能无需JavaScript工作
- 图像有替代文本
- 渐进增强
- 不支持功能的回退

### 边缘情况和边界条件

**空状态**：
- 列表中无项目
- 无搜索结果
- 无通知
- 无数据显示
- 提供清晰下一步行动

**加载状态**：
- 初始加载
- 分页加载
- 刷新
- 显示正在加载什么（"加载您的项目..."）
- 长操作的时间估计

**大数据集**：
- 分页或虚拟滚动
- 搜索/过滤能力
- 性能优化
- 不要一次加载所有10000项目

**并发操作**：
- 防止双重提交（加载时禁用按钮）
- 处理竞争条件
- 乐观更新与回滚
- 冲突解决

**权限状态**：
- 无查看权限
- 无编辑权限
- 只读模式
- 清晰解释为什么

**浏览器兼容性**：
- 现代功能的polyfill
- 不支持CSS的回退
- 功能检测（不是浏览器检测）
- 在目标浏览器测试

### 输入验证和清理

**客户端验证**：
- 必需字段
- 格式验证（电子邮件、电话、URL）
- 长度限制
- 模式匹配
- 自定义验证规则

**服务器端验证**（总是）：
- 从不只信任客户端
- 验证和清理所有输入
- 防止注入攻击
- 速率限制

**约束处理**：
```html
<!-- 设置清晰约束 -->
<input 
  type="text"
  maxlength="100"
  pattern="[A-Za-z0-9]+"
  required
  aria-describedby="username-hint"
/>
<small id="username-hint">
  仅字母和数字，最多100字符
</small>
```

### 可访问性韧性

**键盘导航**：
- 所有功能可通过键盘访问
- 逻辑制表顺序
- 模态中的焦点管理
- 长内容跳过链接

**屏幕阅读器支持**：
- 适当ARIA标签
- 宣布动态变化（实时区域）
- 描述性替代文本
- 语义HTML

**运动敏感**：
```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

**高对比模式**：
- 在Windows高对比模式测试
- 不要只依赖颜色
- 提供替代视觉提示

### 性能韧性

**慢连接**：
- 渐进图像加载
- 骨架屏幕
- 乐观UI更新
- 离线支持（服务工作者）

**内存泄漏**：
- 清理事件监听器
- 取消订阅
- 清除定时器/间隔
- 卸载时中止待定请求

**节流和防抖**：
```javascript
// 防抖搜索输入
const debouncedSearch = debounce(handleSearch, 300);

// 节流滚动处理器
const throttledScroll = throttle(handleScroll, 100);
```

## 测试策略

**手动测试**：
- 用极端数据测试（非常长、非常短、空）
- 用不同语言测试
- 离线测试
- 慢连接测试（节流到3G）
- 用屏幕阅读器测试
- 仅键盘导航测试
- 在旧浏览器测试

**自动化测试**：
- 边缘情况单元测试
- 错误场景集成测试
- 关键路径E2E测试
- 视觉回归测试
- 可访问性测试（axe, WAVE）

**重要**：硬化是关于期待意外。真实用户会做你从未想象的事。

**绝不**：
- 假设完美输入（验证一切）
- 忽略国际化（为全球设计）
- 留下通用错误消息（"发生错误"）
- 忘记离线场景
- 只信任客户端验证
- 为文本使用固定宽度
- 假设英语长度文本
- 当一个组件错误时阻塞整个界面

## 验证硬化

用边缘情况彻底测试：

- **长文本**：尝试100+字符名称
- **表情符号**：在所有文本字段使用表情符号
- **RTL**：用阿拉伯语或希伯来语测试
- **CJK**：用中文/日语/韩语测试
- **网络问题**：禁用互联网，节流连接
- **大数据集**：用1000+项目测试
- **并发行动**：快速点击提交10次
- **错误**：强制API错误，测试所有错误状态
- **空**：移除所有数据，测试空状态

记住：你在为生产现实硬化，不是演示完美。期待用户输入奇怪数据，中途失去连接，并以意外方式使用你的产品。在每个组件中构建韧性。