import { useMemo } from "react";
import { Typography } from "antd";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { EChartOption } from "./types";

const COLORS = [
  "#2f54eb",
  "#13c2c2",
  "#fa8c16",
  "#52c41a",
  "#eb2f96",
  "#722ed1",
  "#faad14",
  "#a0d911",
];

export type ChartKind = "bar" | "line" | "pie";

/** Adapt a platform ECharts option into recharts (bar / line / pie). */
export default function ChartView({
  option,
  chartType,
}: {
  option: EChartOption[];
  chartType: ChartKind;
}) {
  const opt = option?.[0];
  const model = useMemo(() => {
    if (!opt) return null;
    const cats = (opt.xAxis?.data ?? []).map(String);
    const series = opt.series ?? [];
    const keys = series.map((s, i) => s.name || `series${i + 1}`);
    const rows = cats.map((c, i) => {
      const row: Record<string, unknown> = { name: c };
      series.forEach((s, si) => {
        row[keys[si]] = Number(s.data?.[i] ?? 0);
      });
      return row;
    });
    const pieData = cats.map((c, i) => ({
      name: c,
      value: Number(series[0]?.data?.[i] ?? 0),
    }));
    return {
      keys,
      rows,
      pieData,
      title: opt.title?.text,
      horizontal: opt.option_type === "bar_horizontal",
    };
  }, [opt]);

  if (!model || model.rows.length === 0) return null;

  return (
    <div>
      {model.title ? (
        <Typography.Text strong>{model.title}</Typography.Text>
      ) : null}
      <ResponsiveContainer width="100%" height={320}>
        {chartType === "pie" ? (
          <PieChart>
            <Tooltip />
            <Pie
              data={model.pieData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={110}
              label
            >
              {model.pieData.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        ) : chartType === "line" ? (
          <LineChart data={model.rows}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            {model.keys.map((k, i) => (
              <Line
                key={k}
                type="monotone"
                dataKey={k}
                stroke={COLORS[i % COLORS.length]}
                dot={false}
              />
            ))}
          </LineChart>
        ) : (
          <BarChart
            data={model.rows}
            layout={model.horizontal ? "vertical" : "horizontal"}
          >
            <CartesianGrid strokeDasharray="3 3" />
            {model.horizontal ? (
              <>
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={140}
                  tick={{ fontSize: 11 }}
                />
              </>
            ) : (
              <>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
              </>
            )}
            <Tooltip />
            {model.keys.map((k, i) => (
              <Bar key={k} dataKey={k} fill={COLORS[i % COLORS.length]} />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
