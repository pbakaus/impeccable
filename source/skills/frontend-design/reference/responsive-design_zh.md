# 响应式设计

## 移动优先：正确书写

从移动端的基样式开始，使用 `min-width` 查询分层复杂性。桌面优先（`max-width`）意味着移动端首先加载不必要的样式。

## 断点：内容驱动

不要追逐设备尺寸——让内容告诉你哪里断开。从窄开始，拉伸直到设计断开，在那里添加断点。三个断点通常足够（640、768、1024px）。对流体值使用 `clamp()` 而无断点。

## 检测输入方式，而不仅仅是屏幕尺寸

**屏幕尺寸不能告诉你输入方式。** 带触摸屏的笔记本电脑，带键盘的平板——使用指针和悬停查询：

```css
/* 精细指针（鼠标、触控板） */
@media (pointer: fine) {
  .button { padding: 8px 16px; }
}

/* 粗糙指针（触摸、手写笔） */
@media (pointer: coarse) {
  .button { padding: 12px 20px; }  /* 更大的触摸目标 */
}

/* 设备支持悬停 */
@media (hover: hover) {
  .card:hover { transform: translateY(-2px); }
}

/* 设备不支持悬停（触摸） */
@media (hover: none) {
  .card { /* 无悬停状态 - 改为使用活跃 */ }
}
```

**关键**：不要依赖悬停功能。触摸用户不能悬停。

## 安全区域：处理刘海屏

现代手机有刘海屏、圆角和主页指示器。使用 `env()`：

```css
body {
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
}

/* 带回退 */
.footer {
  padding-bottom: max(1rem, env(safe-area-inset-bottom));
}
```

**在元标签中启用 viewport-fit**：
```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
```

## 响应式图像：正确处理

### srcset 与宽度描述符

```html
<img
  src="hero-800.jpg"
  srcset="
    hero-400.jpg 400w,
    hero-800.jpg 800w,
    hero-1200.jpg 1200w
  "
  sizes="(max-width: 768px) 100vw, 50vw"
  alt="Hero image"
>
```

**如何工作**：
- `srcset` 列出可用图像及其实际宽度（`w` 描述符）
- `sizes` 告诉浏览器图像将显示多宽
- 浏览器基于视口宽度和设备像素比率选择最佳文件

### Picture 元素用于艺术指导

当你需要不同裁剪/组成（不仅仅是分辨率）时：

```html
<picture>
  <source media="(min-width: 768px)" srcset="wide.jpg">
  <source media="(max-width: 767px)" srcset="tall.jpg">
  <img src="fallback.jpg" alt="...">
</picture>
```

## 布局适应模式

**导航**：三个阶段——移动端汉堡菜单 + 抽屉，平板端水平紧凑，桌面端完整带标签。**表格**：使用 `display: block` 和 `data-label` 属性在移动端转换为卡片。**渐进披露**：对可以在移动端折叠的内容使用 `<details>/<summary>`。

## 测试：不要只信任 DevTools

DevTools 设备仿真是布局有用，但错过了：

- 实际触摸交互
- 真实 CPU/内存约束
- 网络延迟模式
- 字体渲染差异
- 浏览器铬/键盘外观

**至少测试**：一台真实 iPhone，一台真实 Android，如果相关则平板。便宜 Android 手机揭示你绝不会在仿真器上看到的性能问题。

---

**避免**：桌面优先设计。设备检测而不是功能检测。分离移动/桌面代码库。忽略平板和横向。假设所有移动设备都强大。