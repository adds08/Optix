"use client";

import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { trpc } from "@/lib/trpc";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

/*
  Tool movements per day, last 14 days — the dashboard-01 chart slot.

  Built straight off the transaction ledger: every assign, hand-off, return
  and repair is already recorded with its timestamp, so the rate at which
  tools are moving is one grouping query away, no new tables.
*/

const chartConfig = {
  movements: {
    label: "Movements",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

export function MovementChart() {
  const feed = trpc.transaction.list.useQuery({ limit: 200 });

  const data = useMemo(() => {
    const days = new Map<string, number>();
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.set(d.toISOString().slice(0, 10), 0);
    }
    for (const t of feed.data ?? []) {
      const key = new Date(t.occurredAt).toISOString().slice(0, 10);
      if (days.has(key)) days.set(key, (days.get(key) ?? 0) + 1);
    }
    return [...days.entries()].map(([date, count]) => ({
      date: date.slice(5), // MM-DD
      movements: count,
    }));
  }, [feed.data]);

  return (
    <div className="rounded-md border bg-card p-4">
      <p className="mb-2 text-sm font-medium">Tool movement — last 14 days</p>
      <ChartContainer config={chartConfig} className="h-48 w-full" data-chart="movements">
        <AreaChart data={data} margin={{ left: -24, right: 8, top: 4 }}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={24}
            fontSize={11}
          />
          <YAxis tickLine={false} axisLine={false} allowDecimals={false} fontSize={11} />
          <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
          <Area
            dataKey="movements"
            type="natural"
            fill="var(--color-movements)"
            fillOpacity={0.25}
            stroke="var(--color-movements)"
            strokeWidth={2}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}
