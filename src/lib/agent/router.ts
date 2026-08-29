// ===== Skill Router（P0-04） =====
// 确定性 router：用户消息 → SkillId。rule-based，不引入第二个 LLM。
// 无匹配 → null（由调用方决定回退到 seo-diagnostic 或提示用户）。

import { SKILLS, type SkillId } from "./skills";

export function routeSkill(message: string): SkillId | null {
  const normalized = message.toLowerCase();
  let best: { id: SkillId; score: number } | null = null;
  for (const skill of Object.values(SKILLS)) {
    let score = 0;
    for (const trigger of skill.triggers) {
      if (normalized.includes(trigger.toLowerCase())) score += trigger.length; // 长触发词更具体
    }
    if (score > 0 && (!best || score > best.score)) best = { id: skill.id, score };
  }
  return best?.id ?? null;
}
