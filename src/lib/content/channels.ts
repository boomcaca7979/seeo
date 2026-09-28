// ===== F｜渠道版本「派生」渲染 =====
// 重要边界：这是**派生输出**，不是第二份内容库。
// 主库只有 seo-growth/content-bank.csv 一个；渠道版本按
// seo-growth/content/CHANNEL_PLAYBOOK.md 的固定格式，从同一条 Core 现场展开。
//
// 这样做的原因（§2/§3/§6）：本轮不批量生产 30×5 篇稿件，只建立可长期复用的骨架。

import { getCta } from "./ctas.ts";
import { splitList, type ContentTopic } from "./schema.ts";

interface ChannelShape {
  channel: string;
  label: string;
  /** 骨架模板：{problem} {core} {example} {cta} {audience} 会被替换 */
  skeleton: string[];
}

const SHAPES: readonly ChannelShape[] = [
  {
    channel: "reddit",
    label: "Reddit",
    skeleton: [
      "Problem：用提问者口吻写 —— {problem}",
      "Useful explanation（机制，不是口号）：{core}",
      "Example（具体到检查项或页面结构）：{example}",
      "Optional SeeO mention：仅在真正相关时提一次，给链接",
      "No hard sell：不要 CTA 句、不要「注册即可」",
    ],
  },
  {
    channel: "indie_hackers",
    label: "Indie Hackers",
    skeleton: [
      "Problem（作为 builder 的同一个问题）：{problem}",
      "What we learned（我们自己踩出来的结论）：{core}",
      "Practical takeaway（对方明天能做的一件事）：见支撑点第 1 条",
      "Product context when relevant：只在能解释「为什么做这个」时提",
    ],
  },
  {
    channel: "linkedin",
    label: "LinkedIn",
    skeleton: [
      "Hook（一句反直觉或具体的观察）：{core}",
      "Observation（真实站点上看到的模式，不编数字）：{example}",
      "3 points：取支撑点前 3 条",
      "Conclusion：一句收束，回到 {audience}",
      "Soft CTA：{cta}",
    ],
  },
  {
    channel: "x",
    label: "X",
    skeleton: [
      "Post 1（一条独立成立的判断）：{core}",
      "Post 2–4：逐条展开支撑点",
      "Post 5（例证）：{example}",
      "One CTA max：{cta}",
    ],
  },
  {
    channel: "email",
    label: "Email",
    skeleton: [
      "Problem：{problem}",
      "Useful insight：{core}",
      "Example：{example}",
      "CTA：{cta}",
      "150–250 words；与 C 阶段邮件同一语气（克制、不制造焦虑、只描述真实能力）",
    ],
  },
];

export const CHANNEL_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  SHAPES.map((s) => [s.channel, s.label])
);

function fill(template: string, topic: ContentTopic): string {
  const cta = getCta(topic.cta);
  const ctaText = cta ? `${cta.text}（${cta.href}）` : topic.cta;
  return template
    .replace(/\{problem\}/g, topic.problem)
    .replace(/\{core\}/g, topic.core_point)
    .replace(/\{example\}/g, topic.example)
    .replace(/\{cta\}/g, ctaText)
    .replace(/\{audience\}/g, topic.audience);
}

/**
 * 按 topic 的 channel_fit 展开各渠道骨架（现场派生，不落盘）。
 * 支撑点原文附在每个渠道骨架之后，方便直接改写。
 */
export function showChannelSkeletons(topic: ContentTopic): string {
  const channels = splitList(topic.channel_fit);
  const points = splitList(topic.supporting_points);
  const blocks: string[] = [];

  for (const shape of SHAPES) {
    if (!channels.includes(shape.channel)) continue;
    blocks.push(`## ${shape.label}`);
    shape.skeleton.forEach((line, i) => blocks.push(`${i + 1}. ${fill(line, topic)}`));
    blocks.push("支撑点（可直接改写成该渠道语气）：");
    points.forEach((p) => blocks.push(`   - ${p}`));
    blocks.push("");
  }

  if (blocks.length === 0) return "（该主题未配置任何渠道）";
  blocks.push("提醒：具体数字只能来自真实数据；没有数据就只描述「去看什么」。");
  return blocks.join("\n");
}
