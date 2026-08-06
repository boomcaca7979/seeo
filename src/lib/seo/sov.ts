// ===== SOV（Share of Voice）份额计算 =====
// 排名得分：1-10 名得分 = 11 - 排名，>10 或未上榜 = 0
// 同一域名多个关键词的得分累加，按总得分占比计算百分比

export interface SOVInput {
  domain: string;
  rank: number | null;
}

export interface SOVResult {
  domain: string;
  score: number;
  percentage: number;
  avgRank: number | null;
  top10Count: number;
  keywordCount: number;
}

function rankToScore(rank: number | null): number {
  if (rank === null) return 0;
  if (rank >= 1 && rank <= 10) return 11 - rank;
  return 0;
}

export function calculateSOV(rankings: SOVInput[]): SOVResult[] {
  // 按域名聚合
  const byDomain: Record<string, { score: number; ranks: number[]; keywordCount: number }> = {};

  for (const r of rankings) {
    const domain = r.domain;
    if (!byDomain[domain]) {
      byDomain[domain] = { score: 0, ranks: [], keywordCount: 0 };
    }
    byDomain[domain].score += rankToScore(r.rank);
    byDomain[domain].keywordCount += 1;
    if (r.rank !== null) {
      byDomain[domain].ranks.push(r.rank);
    }
  }

  const totalScore = Object.values(byDomain).reduce((s, d) => s + d.score, 0);

  const results = Object.entries(byDomain).map(([domain, data]) => {
    const avgRank = data.ranks.length > 0
      ? Math.round(data.ranks.reduce((a, b) => a + b, 0) / data.ranks.length)
      : null;
    const top10Count = data.ranks.filter((r) => r <= 10).length;
    const percentage = totalScore > 0
      ? Math.round((data.score / totalScore) * 100)
      : 0;
    return {
      domain,
      score: data.score,
      percentage,
      avgRank,
      top10Count,
      keywordCount: data.keywordCount,
    };
  });

  // 按得分降序
  results.sort((a, b) => b.score - a.score);
  return results;
}
