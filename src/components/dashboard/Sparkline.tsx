"use client";

import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";

interface SparklineProps {
  data: { d: string; v: number }[] | { day: string; value: number }[];
  width?: number;
  height?: number;
  color?: "ink" | "pos" | "neg" | "warn";
}

const strokeMap = {
  ink: "rgba(20,18,26,.62)",
  pos: "#1e9e6a",
  neg: "#e14b4b",
  warn: "#c98a0a",
};

export default function Sparkline({
  data,
  width = 120,
  height = 36,
  color = "ink",
}: SparklineProps) {
  // 归一化字段名
  const normalized = data.map((item: Record<string, unknown>) => ({
    k: (item.d ?? item.day) as string,
    v: (item.v ?? item.value) as number,
  }));

  return (
    <ResponsiveContainer width={width} height={height}>
      <LineChart data={normalized} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <YAxis hide domain={["dataMin", "dataMax"]} />
        <Line
          type="monotone"
          dataKey="v"
          stroke={strokeMap[color]}
          strokeWidth={1.8}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
