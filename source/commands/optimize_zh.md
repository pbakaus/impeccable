---
name: optimize
description: 改进入职性能，涵盖加载速度、渲染、动画、图像和包大小。使体验更快更流畅。
args:
  - name: target
    description: 要优化的功能或区域（可选）
    required: false
---

识别并修复性能问题以创建更快、更流畅的用户体验。

## 评估性能问题

理解当前性能并识别问题：

1. **测量当前状态**：
   - **核心网页关键指标**：LCP、FID/INP、CLS分数
   - **加载时间**：交互时间、首次内容绘制
   - **包大小**：JavaScript、CSS、图像大小
   - **运行时性能**：帧率、内存使用、CPU使用
   - **网络**：请求计数、负载大小、瀑布

2. **识别瓶颈**：
   - 什么慢？（初始加载？交互？动画？）
   - 什么导致它？（大图像？昂贵JavaScript？布局颠簸？）
   - 多严重？（可感知？烦人？阻塞？）
   - 谁受影响？（所有用户？仅移动？慢连接？）

**关键**：测量前后。过早优化浪费时间。优化真正重要的事。

## 优化策略

创建系统改进计划：

### 加载性能

**优化图像**：
- 使用现代格式（WebP、AVIF）
- 适当大小（不要为300px显示加载3000px图像）
- 折叠下方图像懒加载
- 响应式图像（`srcset`、`picture`元素）
- 压缩图像（80-85%质量通常不可感知）
- 使用CDN更快交付

```html
<img 
  src="hero.webp"
  srcset="hero-400.webp 400w, hero-800.webp 800w, hero-1200.webp 1200w"
  sizes="(max-width: 400px) 400px, (max-width: 800px) 800px, 1200px"
  loading="lazy"
  alt="Hero image"
/>
```

**减少JavaScript包**：
- 代码分割（基于路由、基于组件）
- 树摇（移除未使用代码）
- 移除未使用依赖
- 懒加载非关键代码
- 对大组件使用动态导入

```javascript
// 懒加载重组件
const HeavyChart = lazy(() => import('./HeavyChart'));
```

**优化CSS**：
- 移除未使用CSS
- 关键CSS内联，其余异步
- 最小化CSS文件
- 对独立区域使用CSS包含

**优化字体**：
- 使用`font-display: swap`或`optional`
- 子集字体（仅需要字符）
- 预加载关键字体
- 适当使用系统字体
- 限制加载字体权重

```css
@font-face {
  font-family: 'CustomFont';
  src: url('/fonts/custom.woff2') format('woff2');
  font-display: swap; /* 立即显示回退 */
  unicode-range: U+0020-007F; /* 仅基本拉丁 */
}
```

**优化加载策略**：
- 关键资源优先（异步/延迟非关键）
- 预加载关键资产
- 预取可能下一页
- 服务工作者用于离线/缓存
- HTTP/2或HTTP/3用于多路复用

### 渲染性能

**避免布局颠簸**：
```javascript
// ❌ 坏：交替读取和写入（导致重排）
elements.forEach(el => {
  const height = el.offsetHeight; // 读取（强制布局）
  el.style.height = height * 2; // 写入
});

// ✅ 好：批量读取，然后批量写入
const heights = elements.map(el => el.offsetHeight); // 所有读取
elements.forEach((el, i) => {
  el.style.height = heights[i] * 2; // 所有写入
});
```

**优化渲染**：
- 对独立区域使用CSS`contain`属性
- 最小化DOM深度（更平更快）
- 减少DOM大小（更少元素）
- 对长列表使用`content-visibility: auto`
- 对非常长列表虚拟滚动（react-window、react-virtualized）

**减少绘制和合成**：
- 对动画使用`transform`和`opacity`（GPU加速）
- 避免动画布局属性（宽度、高度、顶部、左侧）
- 对已知昂贵操作谨慎使用`will-change`
- 最小化绘制区域（更小更快）

### 动画性能

**GPU加速**：
```css
/* ✅ GPU加速（快） */
.animated {
  transform: translateX(100px);
  opacity: 0.5;
}

/* ❌ CPU绑定（慢） */
.animated {
  left: 100px;
  width: 300px;
}
```

**平滑60fps**：
- 目标每帧16ms（60fps）
- 对JS动画使用`requestAnimationFrame`
- 防抖/节流滚动处理器
- 可能时使用CSS动画
- 在动画期间避免长时间运行JavaScript

**交叉观察器**：
```javascript
// 有效检测元素何时进入视口
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      // 元素可见，懒加载或动画
    }
  });
});
```

### React/框架优化

**React特定**：
- 对昂贵组件使用`memo()`
- 对昂贵计算使用`useMemo()`和`useCallback()`
- 虚拟化长列表
- 代码分割路由
- 在渲染中避免内联函数创建
- 使用React DevTools Profiler

**框架无关**：
- 最小化重新渲染
- 防抖昂贵操作
- 记忆计算值
- 懒加载路由和组件

### 网络优化

**减少请求**：
- 组合小文件
- 对图标使用SVG精灵
- 内联小关键资产
- 移除未使用第三方脚本

**优化API**：
- 使用分页（不要加载一切）
- GraphQL仅请求所需字段
- 响应压缩（gzip、brotli）
- HTTP缓存头
- 静态资产CDN

**为慢连接优化**：
- 基于连接的自适应加载（navigator.connection）
- 乐观UI更新
- 请求优先级
- 渐进增强

## 核心网页关键指标优化

### 最大内容绘制 (LCP < 2.5s)
- 优化英雄图像
- 内联关键CSS
- 预加载关键资源
- 使用CDN
- 服务器端渲染

### 首次输入延迟 (FID < 100ms) / INP (< 200ms)
- 分解长时间任务
- 延迟非关键JavaScript
- 对重计算使用web工作者
- 减少JavaScript执行时间

### 累积布局偏移 (CLS < 0.1)
- 为图像和视频设置尺寸
- 不要在现有内容上方注入内容
- 使用`aspect-ratio` CSS属性
- 为广告/嵌入保留空间
- 避免导致布局偏移的动画

```css
/* 为图像保留空间 */
.image-container {
  aspect-ratio: 16 / 9;
}
```

## 性能监控

**使用工具**：
- Chrome DevTools（Lighthouse、性能面板）
- WebPageTest
- 核心网页关键指标（Chrome UX报告）
- 包分析器（webpack-bundle-analyzer）
- 性能监控（Sentry、DataDog、New Relic）

**关键指标**：
- LCP、FID/INP、CLS（核心网页关键指标）
- 交互时间（TTI）
- 首次内容绘制（FCP）
- 总阻塞时间（TBT）
- 包大小
- 请求计数

**重要**：在真实设备和真实网络条件下测量。快速连接的桌面Chrome不代表性。

**绝不**：
- 没有测量优化（过早优化）
- 为性能牺牲可访问性
- 在优化时破坏功能
- 处处使用`will-change`（创建新层，使用内存）
- 懒加载折叠上方内容
- 在忽略主要问题时优化微优化（首先优化最大瓶颈）
- 忘记移动性能（经常更慢设备、更慢连接）

## 验证改进

测试优化是否有效：

- **前后指标**：比较Lighthouse分数
- **真实用户监控**：跟踪真实用户的改进
- **不同设备**：在低端Android测试，不是仅旗舰iPhone
- **慢连接**：节流到3G，测试体验
- **无回归**：确保功能仍然工作
- **用户感知**：它*感觉*更快吗？

记住：性能是功能。快体验感觉更响应、更抛光、更专业。系统优化，无情测量，优先用户感知性能。