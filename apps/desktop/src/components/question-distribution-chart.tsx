import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

export type DistributionAdjustmentDatum = {
  readonly option: string;
  readonly existing: number;
  readonly increase: number;
  readonly decrease: number;
};

type QuestionDistributionChartProps = {
  readonly data: readonly DistributionAdjustmentDatum[];
  readonly unit: "ratio" | "count";
};

const chartConfig = {
  existing: { label: "원본 유지", color: "var(--chart-1)" },
  increase: { label: "증가 예정", color: "var(--chart-2)" },
  decrease: { label: "감소 예정", color: "var(--destructive)" },
} satisfies ChartConfig;

export const formatChartValue = (value: number, unit: "ratio" | "count"): string =>
  unit === "ratio" ? `${Math.round(value)}%` : `${Math.round(value)}명`;

export function QuestionDistributionChart({ data, unit }: QuestionDistributionChartProps) {
  return (
    <ChartContainer config={chartConfig} className="min-h-72 w-full">
      <BarChart accessibilityLayer data={data as unknown as Record<string, unknown>[]}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="option" tickLine={false} tickMargin={8} axisLine={false} />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={44}
          tickFormatter={(value) => formatChartValue(Number(value), unit)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value, name) => (
                <>
                  <span className="text-muted-foreground">
                    {chartConfig[String(name) as keyof typeof chartConfig]?.label}
                  </span>
                  <span>{formatChartValue(Number(value), unit)}</span>
                </>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="existing" stackId="change" fill="var(--color-existing)" />
        <Bar dataKey="increase" stackId="change" fill="var(--color-increase)" />
        <Bar dataKey="decrease" stackId="change" fill="var(--color-decrease)" />
      </BarChart>
    </ChartContainer>
  );
}

