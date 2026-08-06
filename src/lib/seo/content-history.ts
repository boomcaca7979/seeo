// ===== 内容检查历史对比 =====

export interface ContentHistoryComparison {
  current: { contentScore: number; wordCount: number; checkedAt: string };
  previous: { contentScore: number; wordCount: number; checkedAt: string } | null;
  scoreChange: number;
  wordCountChange: number;
  readabilityChange: number;
  newSuggestions: string[];
  resolvedSuggestions: string[];
}

export interface ContentSnapshot {
  contentScore: number;
  wordCount: number;
  readabilityScore: number;
  titleSuggestions: string[];
  checkedAt: string;
}

export function compareContentChecks(
  current: ContentSnapshot,
  previous: ContentSnapshot | null
): ContentHistoryComparison {
  if (!previous) {
    return {
      current: {
        contentScore: current.contentScore,
        wordCount: current.wordCount,
        checkedAt: current.checkedAt,
      },
      previous: null,
      scoreChange: 0,
      wordCountChange: current.wordCount,
      readabilityChange: 0,
      newSuggestions: current.titleSuggestions,
      resolvedSuggestions: [],
    };
  }

  const previousSet = new Set(previous.titleSuggestions);

  return {
    current: {
      contentScore: current.contentScore,
      wordCount: current.wordCount,
      checkedAt: current.checkedAt,
    },
    previous: {
      contentScore: previous.contentScore,
      wordCount: previous.wordCount,
      checkedAt: previous.checkedAt,
    },
    scoreChange: current.contentScore - previous.contentScore,
    wordCountChange: current.wordCount - previous.wordCount,
    readabilityChange: current.readabilityScore - previous.readabilityScore,
    newSuggestions: current.titleSuggestions.filter((s) => !previousSet.has(s)),
    resolvedSuggestions: previous.titleSuggestions.filter((s) => !new Set(current.titleSuggestions).has(s)),
  };
}
