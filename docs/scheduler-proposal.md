# 📅 排程功能实现说明

> 版本：v1.0.0-45
> 日期：2026-07-30
> 对应代码：`src/modules/scheduler.js`

---

## 一、功能概述

排程系统负责按预设规则自动执行指令，并将结果（可选）通过邮件发送。执行指令的解析与发送复用渲染进程的 `sendToCard()` 流程，因此排程可以像用户手动操作一样匹配网点卡片、注入消息、抓取回复。

## 二、支持的触发方式

| 触发方式 | 说明 | 关键字段 |
|----------|------|----------|
| `startup` | 应用启动后延迟执行 | `delaySeconds`、`priority` |
| `once` | 指定日期时间执行一次 | `executeAt` |
| `daily` | 每日指定时间执行 | `times`（时间数组） |
| `weekly` | 每周指定星期 + 时间执行 | `weekDays`、`times` |
| `monthly` | 每月指定日期 + 时间执行 | `monthDays`、`times` |
| `hourly` | 每小时指定分钟执行 | `minutes`（0-59） |
| `repeating` | 按固定间隔重复执行 | `intervalMinutes` |

## 三、排程数据结构

```typescript
interface Schedule {
  id: string;              // 唯一标识，格式 sched_时间戳
  itemNo: number;          // 创建时的序号
  prompt: string;          // 执行指令
  recurrence: string;      // 触发方式
  executeAt: string | null;     // 一次性执行时间（ISO）
  intervalMinutes: number | null;
  delaySeconds: number;    // 启动排程间的串行等待秒数
  priority: number;        // 启动排程优先级，越小越优先
  resultSendMethod: 'none' | 'email';
  emailRecipients: string; // 邮件收件人，逗号分隔
  notes: string;           // 备注
  weekDays: number[];      // 0=周日, 6=周六
  monthDays: number[];     // 1-31
  times: string[];         // HH:mm 数组
  minutes: number[];       // 0-59
  enabled: boolean;
  lastExecutedAt?: string; // 上次执行时间
  createdAt: string;
  updatedAt: string;
}
```

## 四、执行流程

```
┌─────────────────┐
│ 应用启动 3 秒后  │
└────────┬────────┘
         ▼
┌─────────────────┐     按 priority 排序
│ executeStartupSchedules │
└────────┬────────┘
         ▼
┌─────────────────┐     每 1 秒轮询
│ startScheduleChecker    │
└────────┬────────┘
         ▼
┌─────────────────┐     检查 shouldExecuteSchedule
│ checkSchedules          │
└────────┬────────┘
         ▼
┌─────────────────┐
│ executeSchedule         │ 设置 scheduleEmailRecipientsValue
└────────┬────────┘
         ▼
┌─────────────────┐
│ autoScheduleBeforeExecute │ 自动调度前处理
└────────┬────────┘
         ▼
┌─────────────────┐
│ sendToCard(prompt, [], {skipAutoSchedule:true}) │
└────────┬────────┘
         ▼
┌─────────────────┐
│ 抓取 AI 回复 / 邮件发送  │
└─────────────────┘
```

## 五、启动排程优先级

- 所有 `recurrence === 'startup'` 且 `enabled === true` 的排程会按 `priority` 升序串行执行。
- 相邻排程之间等待 `delaySeconds` 秒，默认 3 秒。
- 高优先级（数值小）的任务先执行。

## 六、定时执行去重

每种定时模式都有去重逻辑，防止同一触发点在检查周期内重复执行：

- `hourly`：同一小时内相同分钟只执行一次。
- `daily`：同一天内相同时间点只执行一次（允许 ±1 分钟容差）。
- `weekly`：同一星期几 + 时间点只执行一次。
- `monthly`：同一日期 + 时间点只执行一次。
- `repeating`：根据 `lastExecutedAt` + `intervalMinutes` 判断。
- `once`：到达 `executeAt` 后执行，执行后自动禁用。

## 七、邮件发送

- 当 `resultSendMethod === 'email'` 且 `emailRecipients` 不为空时，执行前将收件人写入全局变量 `window.scheduleEmailRecipientsValue`。
- `sendEmailAfterReply()` 会在收到 AI 回复后读取该变量并自动发送邮件。
- 执行完成后清空该变量，避免影响后续手动操作。

## 八、数据持久化

- 排程数据：`项目目录/data/schedules.json`
- 排程日志：`项目目录/data/scheduler-logs.json`
- 启动时若发现旧路径 `~/Library/Application Support/.../schedules.json`，会自动迁移到新路径。

## 九、UI 入口

主界面「排程」面板：
- 排程卡片列表：显示状态、触发方式、时间、延迟、优先级。
- 新增/编辑模态框：选择触发方式、输入指令、设置邮件、备注。
- 执行预览：查看未来 24 小时内预计执行的排程。
- 执行日志：查看历史执行记录，支持清空。

## 十、注意事项

1. **排程只执行一次**：每个检查周期内，满足条件的排程会串行执行，执行后立即更新 `lastExecutedAt`。
2. **应用关闭期间错过的任务**：不会补执行；`once` 类型到达时间后如果应用未启动，下次启动也不会补发。
3. **长指令编辑**：执行指令输入框已扩展为 6 行高度 textarea，支持多行指令。
4. **与浮动视窗的交互**：排程执行期间避免手动切换工作区，以免自动调度逻辑冲突。

---

*本文档描述的是 `src/modules/scheduler.js` 的实际实现，与原设计提案可能有所不同。*
