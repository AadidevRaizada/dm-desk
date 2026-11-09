"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface DashboardChartPoint {
  date: string;
  count: number;
}

function formatCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: DashboardChartPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;

  return (
    <div className="hr2 border-2 border-ink bg-paper2 px-3 py-2 text-xs">
      <p className="font-semibold text-foreground">{point.date}</p>
      <p className="mt-0.5 text-muted-foreground">
        {point.count.toLocaleString()} DM
        {point.count === 1 ? "" : "s"} sent
      </p>
    </div>
  );
}

export default function DashboardChart({
  data,
}: {
  data: DashboardChartPoint[];
}) {
  const total = data.reduce((sum, day) => sum + day.count, 0);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>DMs, last 7 days</CardTitle>
        <CardAction>
          <span className="text-xs text-muted-foreground">{total} total</span>
        </CardAction>
      </CardHeader>
      <CardContent className="h-60">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid
              vertical={false}
              stroke="var(--color-border)"
              strokeDasharray="3 3"
            />
            <XAxis
              dataKey="date"
              tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tickFormatter={formatCompact}
              tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={30}
              allowDecimals={false}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ stroke: "var(--color-border)", strokeWidth: 1 }}
            />
            <Area
              type="monotone"
              dataKey="count"
              stroke="var(--ink)"
              strokeWidth={2.6}
              strokeLinejoin="round"
              strokeLinecap="round"
              fill="var(--wash)"
              fillOpacity={1}
              dot={{ r: 3.5, fill: "var(--paper2)", stroke: "var(--ink)", strokeWidth: 2 }}
              activeDot={{
                r: 5,
                fill: "var(--hd-accent)",
                stroke: "var(--ink)",
                strokeWidth: 2,
              }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
