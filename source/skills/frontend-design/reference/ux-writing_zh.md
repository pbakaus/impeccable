# UX写作

## 按钮标签问题

**绝不要使用"OK"、"Submit"或"Yes/No"。** 这些懒惰和模糊。使用具体动词+对象模式：

| 坏 | 好 | 为什么 |
|----|----|--------|
| OK | Save changes | 说出将发生什么 |
| Submit | Create account | 结果聚焦 |
| Yes | Delete message | 确认行动 |
| Cancel | Keep editing | 澄清"cancel"意味着什么 |
| Click here | Download PDF | 描述目的地 |

**对破坏行动**，命名破坏：
- "Delete"不是"Remove"（delete是永久的，remove暗示可恢复）
- "Delete 5 items"不是"Delete selected"（显示计数）

## 错误消息：公式

每个错误消息应该回答：(1) 发生了什么？(2) 为什么？(3) 如何修复？示例："Email address isn't valid. Please include an @ symbol." 不是 "Invalid input"。

### 错误消息模板

| 情况 | 模板 |
|------|------|
| **格式错误** | "[Field] needs to be [format]. Example: [example]" |
| **缺失必需** | "Please enter [what's missing]" |
| **权限拒绝** | "You don't have access to [thing]. [What to do instead]" |
| **网络错误** | "We couldn't reach [thing]. Check your connection and [action]." |
| **服务器错误** | "Something went wrong on our end. We're looking into it. [Alternative action]" |

### 不要责怪用户

重构错误："Please enter a date in MM/DD/YYYY format" 不是 "You entered an invalid date"。

## 空状态是机会

空状态是入职时刻：(1) 简要确认，(2) 解释填充的价值，(3) 提供清晰行动。"No projects yet. Create your first one to get started." 不是只"No items"。

## 声音 vs 语气

**声音** 是你的品牌个性——处处一致。
**语气** 适应时刻。

| 时刻 | 语气转变 |
|------|----------|
| 成功 | 庆祝，简短："Done! Your changes are live." |
| 错误 | 同情，有帮助："That didn't work. Here's what to try..." |
| 加载 | 令人放心："Saving your work..." |
| 破坏确认 | 严重，清晰："Delete this project? This can't be undone." |

**绝不为错误使用幽默。** 用户已经沮丧。有所帮助，不是可爱。

## 为可访问性写作

**链接文本** 必须有独立意义——"View pricing plans" 不是 "Click here"。**替代文本** 描述信息，不是图像——"Revenue increased 40% in Q4" 不是 "Chart"。对装饰图像使用 `alt=""`。**图标按钮** 需要 `aria-label` 为屏幕阅读器上下文。

## 为翻译写作

### 为扩展规划

德语文本比英语长~30%。分配空间：

| 语言 | 扩展 |
|------|------|
| 德语 | +30% |
| 法语 | +20% |
| 芬兰语 | +30-40% |
| 中文 | -30% (更少字符，但相同宽度) |

### 翻译友好模式

保持数字分离（"New messages: 3" 不是 "You have 3 new messages"）。将完整句子作为单个字符串（词序因语言变化）。避免缩写（"5 minutes ago" 不是 "5 mins ago"）。给翻译者关于字符串出现在哪里的上下文。

## 一致性：术语问题

选择一个术语并坚持：

| 不一致 | 一致 |
|--------|------|
| Delete / Remove / Trash | Delete |
| Settings / Preferences / Options | Settings |
| Sign in / Log in / Enter | Sign in |
| Create / Add / New | Create |

构建术语词汇表并强制它。多样性创造混乱。

## 避免冗余副本

如果标题解释它，介绍是冗余的。如果按钮清晰，不要再次解释它。说一次，说得好。

## 加载状态

具体："Saving your draft..." 不是 "Loading...". 对长等待，设置期望（"This usually takes 30 seconds"）或显示进度。

## 确认对话框：谨慎使用

大多数确认对话框是设计失败——考虑撤销代替。当你必须确认时：命名行动，解释后果，使用具体按钮标签（"Delete project" / "Keep project"，不是 "Yes" / "No"）。

## 表单说明

用占位符显示格式，不是说明。对不明显的字段，解释为什么询问。

---

**避免**：无解释的行话。责怪用户（"You made an error" → "This field is required"）。模糊错误（"Something went wrong"）。为多样性变化术语。为错误幽默。