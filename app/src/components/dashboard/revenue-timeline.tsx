// The revenue timeline: one gray bar per charge, one orange line for the
// running total.
//
// Orange leads and the grays sit behind it, because the cumulative line is
// the figure the page is arguing about and the individual charges are the
// evidence under it. Both series are in STRK on one axis with a zero
// baseline, so the bars and the line can be compared without a reader
// working out which scale belongs to which shape.
//
// There is no legend. The line is named where it ends and the bars are
// labelled with their own values, which is the only naming the reader has to
// look up. Animation is off on both series; the single first-mount draw-in
// belongs to the container.

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  ReferenceDot,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { truncate } from "../../config";
import { ChartContainer, ChartTooltipContent } from "../ui/chart";
import type { RevenuePoint } from "./derive";
import { stampUtc } from "./derive";

function Annotation(p: RevenuePoint) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-text-strong">{p.cumulativeLabel} STRK total</div>
      <div>
        {p.amountLabel} STRK · period {p.periodIndex}
      </div>
      <div className="text-text-caption">{stampUtc(p.ts)}</div>
      <div className="text-text-caption">block {p.block.toLocaleString("en-US")}</div>
      <div className="text-text-caption">tx {truncate(p.txHash)}</div>
    </div>
  );
}

export function RevenueTimeline({
  points,
  height = 240,
  compact = false,
}: {
  points: RevenuePoint[];
  height?: number;
  compact?: boolean;
}) {
  const last = points[points.length - 1];
  // Per-bar value labels are a direct label while they can be read. Past a
  // dozen or so bars they overlap into a gray smear, and the y axis is doing
  // that job anyway, so they come off.
  const barLabels = !compact && points.length <= 12;
  return (
    <ChartContainer
      height={height}
      label={`Revenue timeline: ${points.length} charges, ${last ? last.cumulativeLabel : "0.00"} STRK cumulative`}
    >
      <ComposedChart data={points} margin={{ top: 18, right: compact ? 12 : 64, bottom: 4, left: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          minTickGap={compact ? 24 : 48}
          interval="preserveStartEnd"
          padding={{ left: 12, right: 12 }}
        />
        <YAxis
          width={44}
          tickLine={false}
          axisLine={false}
          domain={[0, "auto"]}
          allowDecimals
          tickCount={4}
        />
        <Tooltip
          cursor={{ strokeWidth: 1 }}
          isAnimationActive={false}
          content={(props) => (
            <ChartTooltipContent<RevenuePoint>
              active={props.active}
              payload={props.payload}
              describe={Annotation}
            />
          )}
        />
        <Bar
          dataKey="amount"
          fill="var(--chart-3)"
          isAnimationActive={false}
          maxBarSize={compact ? 14 : 26}
        >
          {barLabels ? (
            <LabelList
              dataKey="amountLabel"
              position="top"
              fill="var(--text-caption)"
              fontSize={11}
            />
          ) : null}
        </Bar>
        <Line
          type="linear"
          dataKey="cumulative"
          stroke="var(--chart-1)"
          strokeWidth={1.5}
          dot={{ r: 2, fill: "var(--chart-1)", stroke: "none" }}
          activeDot={{ r: 3, fill: "var(--chart-1)", stroke: "none" }}
          isAnimationActive={false}
        />
        {last ? (
          <ReferenceDot
            x={last.label}
            y={last.cumulative}
            r={0}
            label={{
              value: compact ? `${last.cumulativeLabel} total` : `cumulative ${last.cumulativeLabel} STRK`,
              position: compact ? "top" : "right",
              fill: "var(--chart-1)",
              fontSize: 11,
            }}
          />
        ) : null}
      </ComposedChart>
    </ChartContainer>
  );
}
