import { useRef, useState } from "react";

import type { RunTargetBaseline, TargetOutcome } from "@survey-synth/contracts";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { runBaselineValue } from "./runBaseline";

type ChartType = "bar" | "column" | "donut";

type ResultChartProps = {
  questionTitle: string;
  outcomes: readonly TargetOutcome[];
  baselines: readonly RunTargetBaseline[];
  labels: ReadonlyMap<string, string>;
};

type ChartDatum = {
  kind: TargetOutcome["kind"];
  label: string;
  current: number;
  target: number;
  result: number;
  displayCurrent: string;
  displayTarget: string;
  displayResult: string;
};

const numericBaseline = (baseline: RunTargetBaseline | undefined): number => {
  if (!baseline) return 0;
  if (baseline.kind === "mean") return baseline.mean;
  if (baseline.kind === "count") return baseline.count;
  return baseline.share;
};

const displayValue = (outcome: TargetOutcome, value: number): string => {
  if (outcome.kind === "mean") return value.toFixed(2);
  if (outcome.kind === "count") return `${Math.round(value)}명`;
  return `${(value * 100).toFixed(1)}%`;
};

const safeFileName = (value: string): string =>
  value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .trim()
    .slice(0, 80) || "survey-synth-chart";

const svgString = (svg: SVGSVGElement): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`;

const pngDataUrl = async (svg: SVGSVGElement): Promise<string> => {
  const markup = svgString(svg);
  const image = new Image();
  const source = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("차트를 이미지로 변환하지 못했습니다."));
      image.src = source;
    });
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = Number(svg.getAttribute("width") ?? 720) * scale;
    canvas.height = Number(svg.getAttribute("height") ?? 300) * scale;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("차트를 이미지로 변환하지 못했습니다.");
    context.scale(scale, scale);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(source);
  }
};

export function ResultChart({ questionTitle, outcomes, baselines, labels }: ResultChartProps) {
  const [type, setType] = useState<ChartType>("bar");
  const [message, setMessage] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const data: ChartDatum[] = outcomes.map((outcome) => {
    const baseline = baselines.find(
      (candidate) => String(candidate.targetId) === String(outcome.targetId),
    );
    const current = numericBaseline(baseline);
    return {
      kind: outcome.kind,
      label: labels.get(String(outcome.targetId)) ?? "목표",
      current,
      target: outcome.requested,
      result: outcome.achieved,
      displayCurrent: runBaselineValue(baseline),
      displayTarget: displayValue(outcome, outcome.requested),
      displayResult: displayValue(outcome, outcome.achieved),
    };
  });
  const canUseDonut = data.every(
    (datum) => datum.kind === "share" || datum.kind === "conditional_share",
  );
  const chartType = canUseDonut ? type : type === "donut" ? "bar" : type;
  const height = Math.max(160, data.length * 72 + 42);

  const copy = async () => {
    if (!svgRef.current) return;
    try {
      await window.surveySynth.copyChart(await pngDataUrl(svgRef.current));
      setMessage("차트를 클립보드에 복사했습니다.");
    } catch {
      setMessage("차트를 복사하지 못했습니다.");
    }
  };

  const save = async () => {
    if (!svgRef.current) return;
    try {
      const result = await window.surveySynth.saveChart(
        svgString(svgRef.current),
        `${safeFileName(questionTitle)}-결과차트.svg`,
      );
      setMessage(result === "saved" ? "SVG 차트를 저장했습니다." : null);
    } catch {
      setMessage("차트를 저장하지 못했습니다.");
    }
  };

  return (
    <div className="mt-5 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-medium">결과 차트</h4>
          <p className="mt-1 text-xs text-muted-foreground">현재 · 목표 · 결과를 비교합니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={chartType} onValueChange={(value) => setType(value as ChartType)}>
            <SelectTrigger className="h-8 w-[132px]" aria-label="차트 형태">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bar">가로 막대</SelectItem>
              <SelectItem value="column">세로 막대</SelectItem>
              {canUseDonut ? <SelectItem value="donut">도넛</SelectItem> : null}
            </SelectContent>
          </Select>
          <Button type="button" size="sm" variant="outline" onClick={() => void copy()}>
            복사
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => void save()}>
            저장
          </Button>
        </div>
      </div>
      <div className="mt-4 overflow-x-auto rounded-lg bg-muted/30 p-3">
        <svg
          ref={svgRef}
          width="720"
          height={chartType === "column" ? 300 : height}
          viewBox={`0 0 720 ${chartType === "column" ? 300 : height}`}
          role="img"
          aria-label={`${questionTitle} 결과 차트`}
        >
          <rect width="720" height={chartType === "column" ? 300 : height} fill="#ffffff" />
          <text
            x="18"
            y="25"
            fill="#18181b"
            fontFamily="Arial, sans-serif"
            fontSize="15"
            fontWeight="600"
          >
            {questionTitle}
          </text>
          {chartType === "bar" &&
            data.map((datum, index) => {
              const y = 48 + index * 72;
              const maximum = Math.max(1, datum.current, datum.target, datum.result);
              return (
                <g key={datum.label}>
                  <text
                    x="18"
                    y={y + 13}
                    fill="#3f3f46"
                    fontFamily="Arial, sans-serif"
                    fontSize="12"
                  >
                    {datum.label}
                  </text>
                  {([datum.current, datum.target, datum.result] as const).map(
                    (number, itemIndex) => (
                      <rect
                        key={itemIndex}
                        x="210"
                        y={y + 2 + itemIndex * 16}
                        width={Math.max(2, (number / maximum) * 470)}
                        height="11"
                        rx="3"
                        fill={["#71717a", "#0ea5e9", "#18181b"][itemIndex]}
                      />
                    ),
                  )}
                  <text
                    x="690"
                    y={y + 12}
                    textAnchor="end"
                    fill="#3f3f46"
                    fontFamily="Arial, sans-serif"
                    fontSize="11"
                  >
                    {datum.displayCurrent} / {datum.displayTarget} / {datum.displayResult}
                  </text>
                </g>
              );
            })}
          {chartType === "column" &&
            data.map((datum, index) => {
              const x = 70 + index * (620 / data.length);
              const width = Math.min(42, 170 / data.length);
              const maximum = Math.max(1, datum.current, datum.target, datum.result);
              return (
                <g key={datum.label}>
                  <text
                    x={x + width * 1.5}
                    y="278"
                    textAnchor="middle"
                    fill="#3f3f46"
                    fontFamily="Arial, sans-serif"
                    fontSize="11"
                  >
                    {datum.label}
                  </text>
                  {([datum.current, datum.target, datum.result] as const).map(
                    (number, itemIndex) => {
                      const barHeight = (number / maximum) * 190;
                      return (
                        <rect
                          key={itemIndex}
                          x={x + itemIndex * (width + 5)}
                          y={250 - barHeight}
                          width={width}
                          height={barHeight}
                          rx="3"
                          fill={["#71717a", "#0ea5e9", "#18181b"][itemIndex]}
                        />
                      );
                    },
                  )}
                </g>
              );
            })}
          {chartType === "donut" &&
            data.map((datum, index) => {
              const radius = 35;
              const circumference = 2 * Math.PI * radius;
              const centerX = 105 + index * (590 / data.length);
              const progress = Math.max(0, Math.min(1, datum.result));
              return (
                <g key={datum.label}>
                  <circle
                    cx={centerX}
                    cy="145"
                    r={radius}
                    fill="none"
                    stroke="#e4e4e7"
                    strokeWidth="13"
                  />
                  <circle
                    cx={centerX}
                    cy="145"
                    r={radius}
                    fill="none"
                    stroke="#18181b"
                    strokeWidth="13"
                    strokeLinecap="round"
                    strokeDasharray={`${circumference * progress} ${circumference}`}
                    transform={`rotate(-90 ${centerX} 145)`}
                  />
                  <text
                    x={centerX}
                    y="150"
                    textAnchor="middle"
                    fill="#18181b"
                    fontFamily="Arial, sans-serif"
                    fontSize="11"
                    fontWeight="600"
                  >
                    {datum.displayResult}
                  </text>
                  <text
                    x={centerX}
                    y="205"
                    textAnchor="middle"
                    fill="#3f3f46"
                    fontFamily="Arial, sans-serif"
                    fontSize="12"
                  >
                    {datum.label}
                  </text>
                  <text
                    x={centerX}
                    y="225"
                    textAnchor="middle"
                    fill="#71717a"
                    fontFamily="Arial, sans-serif"
                    fontSize="10"
                  >
                    현재 {datum.displayCurrent} · 목표 {datum.displayTarget}
                  </text>
                </g>
              );
            })}
          <g
            transform={`translate(18 ${chartType === "column" ? 48 : height - 14})`}
            fontFamily="Arial, sans-serif"
            fontSize="10"
          >
            <rect width="9" height="9" rx="2" fill="#71717a" />
            <text x="13" y="8" fill="#52525b">
              현재
            </text>
            <rect x="52" width="9" height="9" rx="2" fill="#0ea5e9" />
            <text x="65" y="8" fill="#52525b">
              목표
            </text>
            <rect x="104" width="9" height="9" rx="2" fill="#18181b" />
            <text x="117" y="8" fill="#52525b">
              결과
            </text>
          </g>
        </svg>
      </div>
      {message ? (
        <p className="mt-2 text-xs text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
