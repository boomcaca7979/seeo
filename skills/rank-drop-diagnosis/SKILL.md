---
name: rank-drop-diagnosis
description: "Cross-examine declined/lost keywords against live SERPs and GSC to build an evidence chain for why rankings dropped. Never guess penalties."
---

# SeeO Rank Drop Diagnosis

## Purpose

回答"排名为什么下降"——用证据链而非猜测。输出 FACT / SERP CHANGE / COMPETITOR CHANGE / GSC CHANGE / POSSIBLE CAUSE（不是 certainty）。

## Trigger

"排名为什么下降" / "rank dropped" / "排名掉了" / "lost rankings".

## Required Context

- `projectId`（无需其他参数）

## Tool Selection（预算：最多 6 次调用）

| Order | Tool | Cost | Purpose |
| ----- | ---- | ---- | ------- |
| 1 | `get_rank_history` | free (DB) | declined/lost 清单与幅度 |
| 2-3 | `get_serp_results` ×≤2 | SerpApi | 受影响最重词的 SERP 现状 |
| 4 | `search_console_tools` (top_queries) | GSC | 流量侧交叉验证（可选） |

## Decision Rules（证据组合 → 解读方向）

- SERP 前列域名与既往不同 / 新 feature 块 → 竞争或 SERP 结构变化
- GSC impressions 同步下降 → 真实可见性下降（而非测量波动）
- GSC impressions 稳定而 rank 下降 → 平均位置 vs 头部位置差异，观察为主
- ranking URL 变化（rank history）→ Google 换页信号（cannibalization 基础）
- 任何情况下禁止"被 Google 惩罚"结论，除非有真实 manual action 证据（SeeO 不提供该数据 → 永不可下此结论）

## Workflow

1. `get_rank_history` 找 declined/lost。
2. 取受影响最重的 ≤2 个词查实时 SERP。
3. GSC top_queries 交叉（可用时）。
4. 输出每个词的：Rank 变化 / SERP 变化 / GSC 变化 / POSSIBLE CAUSE（标注不确定性）。

## Failure Handling

GSC 不可用 → DATA GAP「流量侧无法交叉验证」；SERP 失败 → DATA GAP；两者都不阻断 rank 侧结论（降置信度）。
