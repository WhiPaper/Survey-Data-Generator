import { memo, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { CalendarIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import type { FormSnapshot, ProjectTargets } from "@survey-synth/domain";
import type { ProjectTimeline } from "@survey-synth/contracts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { getProjectTimeline } from "@/api/backend";
import { Alert, AlertDescription } from "@/components/ui/alert";

export type ProjectHomeProps = {
  readonly form: FormSnapshot;
  readonly projectId: string;
  readonly sourceCount: number;
  readonly targets: ProjectTargets;
  readonly onChange: (targets: ProjectTargets) => void;
  readonly disabled: boolean;
  readonly createdAt?: string;
  readonly responseTimestampRange?: { readonly start: string; readonly end: string } | null;
  readonly onTimestampRangeChange?: (range: { start: string; end: string }) => void;
};

const chartConfig = {
  current: {
    label: "원본",
    color: "var(--chart-1)",
  },
  added: {
    label: "추가",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig;

const formatToLocalIso = (date: Date): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${y}-${m}-${d}T${h}:${min}`;
};

const formatDateTimeLabel = (date: Date | undefined): string => {
  if (!date) return "날짜 선택";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

type DateTimePickerProps = {
  readonly id: string;
  readonly label: string;
  readonly timestamp: string;
  readonly onChange: (timestamp: string) => void;
  readonly disabled: boolean;
};

function DateTimePicker({
  id,
  label,
  timestamp,
  onChange,
  disabled,
}: DateTimePickerProps) {
  const [open, setOpen] = useState(false);
  const date = new Date(timestamp);

  const handleDateChange = (nextDate: Date | undefined) => {
    if (!nextDate) return;
    const current = new Date(timestamp);
    if (!Number.isNaN(current.getTime())) {
      nextDate.setHours(current.getHours(), current.getMinutes(), 0, 0);
    }
    onChange(formatToLocalIso(nextDate));
  };

  const handleTimeChange = (value: string) => {
    if (!value) return;
    const next = new Date(timestamp);
    const [hours = Number.NaN, minutes = Number.NaN] = value.split(":").map(Number);
    if (Number.isNaN(next.getTime()) || Number.isNaN(hours) || Number.isNaN(minutes)) return;
    next.setHours(hours, minutes, 0, 0);
    onChange(formatToLocalIso(next));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="outline" disabled={disabled} aria-label={`${label} 선택`} />}
        className="h-9 w-full justify-start gap-2 bg-muted/45 text-left text-xs font-normal"
      >
        <CalendarIcon data-icon="inline-start" />
        <span className="truncate">{formatDateTimeLabel(date)}</span>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <PopoverTitle className="sr-only">{label} 날짜와 시간 선택</PopoverTitle>
        <Calendar
          mode="single"
          selected={Number.isNaN(date.getTime()) ? undefined : date}
          onSelect={handleDateChange}
          captionLayout="dropdown"
          className="[--cell-size:--spacing(8)]"
        />
        <label className="grid gap-1 border-t p-3 text-xs font-medium" htmlFor={`${id}-time`}>
          시간
          <Input
            id={`${id}-time`}
            type="time"
            value={timestamp.slice(11, 16)}
            onChange={(event) => handleTimeChange(event.target.value)}
          />
        </label>
      </PopoverContent>
    </Popover>
  );
}

export type TimelineDatum = {
  readonly timestamp: string;
  readonly current: number;
  readonly added: number;
  readonly target: number;
};

const allocateAddedCounts = (
  additionalCount: number,
  originalCounts: readonly number[],
): number[] => {
  if (additionalCount <= 0 || originalCounts.length === 0) return originalCounts.map(() => 0);
  const weights = originalCounts.map((count) => Math.max(0, count));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const normalizedWeights =
    weightTotal > 0 ? weights : originalCounts.map(() => 1);
  const totalWeight = normalizedWeights.reduce((sum, weight) => sum + weight, 0);
  const quotas = normalizedWeights.map((weight) => (weight / totalWeight) * additionalCount);
  const added = quotas.map((quota) => Math.floor(quota));
  let remainder = additionalCount - added.reduce((sum, count) => sum + count, 0);
  const remainderOrder = quotas
    .map((quota, index) => ({
      index,
      fraction: quota - Math.floor(quota),
      weight: normalizedWeights[index] ?? 0,
    }))
    .sort((left, right) =>
      right.fraction - left.fraction || right.weight - left.weight || left.index - right.index,
    );
  for (let position = 0; position < remainder; position += 1) {
    const index = remainderOrder[position % remainderOrder.length]?.index;
    if (index !== undefined) added[index] = (added[index] ?? 0) + 1;
  }
  return added;
};

export const buildTimelineData = (
  timeline: ProjectTimeline,
  targetCount: number,
): readonly TimelineDatum[] => {
  const originalCounts = timeline.buckets.map((bucket) => bucket.originalCount);
  const visibleSourceCount = originalCounts.reduce((sum, count) => sum + count, 0);
  const sourceCount = timeline.sourceTotalCount;
  const finalCount = Math.max(sourceCount, Number.isNaN(targetCount) ? sourceCount : targetCount);
  const totalAdditional = finalCount - sourceCount;
  const visibleAdditional = Math.round(
    totalAdditional * (visibleSourceCount / Math.max(1, sourceCount)),
  );
  const addedCounts = allocateAddedCounts(visibleAdditional, originalCounts);

  return timeline.buckets.map((bucket, index) => {
    const current = bucket.originalCount;
    const added = bucket.syntheticCount ?? addedCounts[index] ?? 0;
    return { timestamp: bucket.label, current, added, target: current + added };
  });
};

export const generateTimelineData = (
  startStr: string,
  endStr: string,
  sourceCount: number,
  targetCount: number,
): readonly TimelineDatum[] => {
  let startDate = new Date(startStr);
  let endDate = new Date(endStr);

  if (
    Number.isNaN(startDate.getTime()) ||
    Number.isNaN(endDate.getTime()) ||
    endDate <= startDate
  ) {
    endDate = new Date();
    startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
  }

  const diffMs = endDate.getTime() - startDate.getTime();
  const diffDays = Math.max(1, Math.round(diffMs / (24 * 60 * 60 * 1000)));
  // Give short periods useful resolution while keeping long timelines readable.
  const bucketCount = Math.min(96, Math.max(8, Math.round(diffDays * 6)));
  const stepMs = diffMs / (bucketCount - 1 || 1);

  // Generate smooth distribution bell/curve weights
  const weights = [];
  for (let i = 0; i < bucketCount; i++) {
    const x = (i / (bucketCount - 1 || 1)) * 2 - 1; // -1 to 1
    const w = Math.exp(-2 * x * x);
    weights.push(w);
  }
  const sumWeights = weights.reduce((acc, val) => acc + val, 0) || 1;

  // Allocate current counts summing exactly to sourceCount
  let allocatedCurrent = 0;
  const currentCounts = weights.map((w) => {
    const count = Math.floor((w / sumWeights) * sourceCount);
    allocatedCurrent += count;
    return count;
  });
  let remainderCurrent = sourceCount - allocatedCurrent;
  for (let i = bucketCount - 1; i >= 0 && remainderCurrent > 0; i--) {
    currentCounts[i] = (currentCounts[i] ?? 0) + 1;
    remainderCurrent -= 1;
  }

  // Allocate target counts summing exactly to targetCount
  const validTargetCount = Math.max(
    sourceCount,
    Number.isNaN(targetCount) ? sourceCount : targetCount,
  );
  let allocatedTarget = 0;
  const targetCounts = weights.map((w) => {
    const count = Math.floor((w / sumWeights) * validTargetCount);
    allocatedTarget += count;
    return count;
  });
  let remainderTarget = validTargetCount - allocatedTarget;
  for (let i = bucketCount - 1; i >= 0 && remainderTarget > 0; i--) {
    targetCounts[i] = (targetCounts[i] ?? 0) + 1;
    remainderTarget -= 1;
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  return Array.from({ length: bucketCount }, (_, i) => {
    const pointDate = new Date(startDate.getTime() + i * stepMs);
    const m = pad(pointDate.getMonth() + 1);
    const d = pad(pointDate.getDate());
    const label = diffDays <= 2 ? `${m}/${d} ${pad(pointDate.getHours())}:00` : `${m}/${d}`;

    const cur = currentCounts[i] ?? 0;
    const tgt = Math.max(cur, targetCounts[i] ?? cur);
    const add = tgt - cur;

    return {
      timestamp: label,
      current: cur,
      added: add,
      target: tgt,
    };
  });
};

export const ProjectHomeView = memo(function ProjectHomeView({
  form: _form,
  projectId,
  sourceCount,
  targets,
  onChange,
  disabled,
  createdAt,
  responseTimestampRange,
  onTimestampRangeChange,
}: ProjectHomeProps) {
  const initialEndDate = useMemo(() => {
    const parsed = responseTimestampRange?.end ? new Date(responseTimestampRange.end) : new Date();
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }, [responseTimestampRange?.end]);
  const initialStartDate = useMemo(() => {
    if (responseTimestampRange?.start) {
      const parsed = new Date(responseTimestampRange.start);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    if (createdAt) {
      const parsed = new Date(createdAt);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return new Date(initialEndDate.getTime() - 7 * 24 * 60 * 60 * 1000);
  }, [createdAt, initialEndDate, responseTimestampRange?.start]);

  const [startTimestamp, setStartTimestamp] = useState(() => formatToLocalIso(initialStartDate));
  const [endTimestamp, setEndTimestamp] = useState(() => formatToLocalIso(initialEndDate));

  const updateTimestampRange = (nextStart: string, nextEnd: string): void => {
    const start = new Date(nextStart);
    const end = new Date(nextEnd);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end > start) {
      onTimestampRangeChange?.({ start: start.toISOString(), end: end.toISOString() });
    }
  };

  const handleAdditionalChange = (valueStr: string) => {
    if (valueStr.trim() === "") {
      onChange({ ...targets, targetResponseCount: rangeSourceCount });
      return;
    }
    const additional = parseInt(valueStr, 10);
    if (!Number.isNaN(additional) && additional >= 0) {
      onChange({ ...targets, targetResponseCount: rangeSourceCount + additional });
    }
  };

  const handleTotalChange = (valueStr: string) => {
    if (valueStr.trim() === "") {
      onChange({ ...targets, targetResponseCount: NaN });
      return;
    }
    const total = parseInt(valueStr, 10);
    if (!Number.isNaN(total)) {
      onChange({ ...targets, targetResponseCount: Math.max(rangeSourceCount, total) });
    }
  };

  const timelineRequest = useMemo(() => {
    const start = new Date(startTimestamp);
    const end = new Date(endTimestamp);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;
    return {
      start: start.toISOString(),
      end: end.toISOString(),
      // Keep a stable, dense timeline regardless of the selected range length.
      bucketCount: 240,
    };
  }, [endTimestamp, startTimestamp]);

  const timelineQuery = useQuery({
    queryKey: [
      "projects.timeline",
      projectId,
      timelineRequest?.start,
      timelineRequest?.end,
      timelineRequest?.bucketCount,
      targets.targetResponseCount,
    ],
    queryFn: () =>
      getProjectTimeline(
        projectId,
        timelineRequest!.start,
        timelineRequest!.end,
        timelineRequest!.bucketCount,
        Number.isNaN(targets.targetResponseCount) ? sourceCount : targets.targetResponseCount,
        1,
      ),
    enabled: timelineRequest !== null,
    staleTime: 60_000,
    retry: false,
    placeholderData: (previous) => previous,
  });

  const rangeSourceCount = timelineQuery.data?.totalOriginalCount ?? sourceCount;
  useEffect(() => {
    if (
      timelineQuery.data !== undefined &&
      Number.isInteger(targets.targetResponseCount) &&
      targets.targetResponseCount < rangeSourceCount
    ) {
      onChange({ ...targets, targetResponseCount: rangeSourceCount });
    }
  }, [onChange, rangeSourceCount, targets, timelineQuery.data]);
  const totalCount = Number.isNaN(targets.targetResponseCount)
    ? rangeSourceCount
    : Math.max(rangeSourceCount, targets.targetResponseCount);
  const additionalCount = Math.max(0, totalCount - rangeSourceCount);

  const chartData = useMemo(
    () => (timelineQuery.data ? buildTimelineData(timelineQuery.data, targets.targetResponseCount) : []),
    [targets.targetResponseCount, timelineQuery.data],
  );

  return (
    <div className="home-infographic flex flex-1 flex-col p-4 sm:p-6 lg:p-8">
      <section className="home-infographic-layout" aria-label="응답 증강 요약">
        <div className="home-infographic-header">
          <div className="home-total-block">
            <div className="home-total-value">
              <Input
                id="total-response-count"
                type="number"
                min={rangeSourceCount}
                step="1"
                value={Number.isNaN(targets.targetResponseCount) ? "" : totalCount}
                onChange={(e) => handleTotalChange(e.target.value)}
                disabled={disabled}
                className="home-total-input"
                aria-label="최종 인원"
              />
              <span>명</span>
            </div>
            <div
              className="home-count-breakdown"
                aria-label={`원본 ${rangeSourceCount}명, 추가 ${additionalCount}명`}
              >
              <span>{rangeSourceCount}</span>
              <span className="home-count-plus">+</span>
              <label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={Number.isNaN(targets.targetResponseCount) ? "" : additionalCount}
                  onChange={(e) => handleAdditionalChange(e.target.value)}
                  disabled={disabled}
                  className="home-additional-input"
                  aria-label="추가 인원"
                />
              </label>
            </div>
          </div>

          <div className="home-period-block">
            <div className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
              <DateTimePicker
                id="response-period-start"
                label="응답 기간 시작"
                timestamp={startTimestamp}
                onChange={(value) => {
                  setStartTimestamp(value);
                  updateTimestampRange(value, endTimestamp);
                }}
                disabled={disabled}
              />
              <span className="hidden text-muted-foreground sm:inline" aria-hidden="true">→</span>
              <DateTimePicker
                id="response-period-end"
                label="응답 기간 끝"
                timestamp={endTimestamp}
                onChange={(value) => {
                  setEndTimestamp(value);
                  updateTimestampRange(startTimestamp, value);
                }}
                disabled={disabled}
              />
            </div>
          </div>
        </div>

        <div className="home-infographic-chart">
          <div className="home-chart-caption">
            <span className="home-chart-legend" aria-label="원본 및 추가 응답">
              <i className="home-legend-swatch home-legend-original" aria-hidden="true" />
              <i className="home-legend-swatch home-legend-added" aria-hidden="true" />
            </span>
          </div>
          {timelineQuery.isError ? (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>응답 시간 분포를 불러오지 못했습니다.</AlertDescription>
            </Alert>
          ) : (
            <ChartContainer
              config={chartConfig}
              className="min-h-[300px] w-full flex-1 sm:min-h-[380px]"
            >
              <BarChart accessibilityLayer data={chartData} barCategoryGap="0%" barGap={0}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="timestamp"
                  tickLine={false}
                  tickMargin={10}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={42}
                  tickFormatter={(value) => `${value}`}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value, name) => (
                        <>
                          <span className="text-muted-foreground">
                            {chartConfig[name as keyof typeof chartConfig]?.label ?? name}
                          </span>
                          <span className="font-semibold">{Number(value)}명</span>
                        </>
                      )}
                    />
                  }
                />
                <Bar
                  dataKey="current"
                  stackId="survey"
                  fill="var(--color-current)"
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="added"
                  stackId="survey"
                  fill="var(--color-added)"
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ChartContainer>
          )}
        </div>
      </section>
    </div>
  );
});
