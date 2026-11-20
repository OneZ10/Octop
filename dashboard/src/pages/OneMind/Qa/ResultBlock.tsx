import { useEffect, useMemo, useRef, useState } from "react";
import { Table, Typography } from "antd";
import {
  BarChart3,
  Download,
  Image as ImageIcon,
  LineChart,
  PieChart,
  Table2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import * as XLSX from "xlsx";
import { HighlightedCode } from "../../../components/Markdown/syntaxHighlight";
import { saveBlobAsFile } from "../../../utils/saveBlobAsFile";
import ChartView, { type ChartKind } from "./ChartView";
import { PillSegmented, ToolButton } from "./ui";
import styles from "./qa.module.less";
import type { ChatResult, EChartOption } from "./types";

function exportChartPng(container: HTMLElement | null, name: string) {
  const svg = container?.querySelector("svg");
  if (!svg) return;
  const w = svg.clientWidth || 800;
  const h = svg.clientHeight || 320;
  const clone = svg.cloneNode(true) as SVGElement;
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const xml = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(
    new Blob([xml], { type: "image/svg+xml;charset=utf-8" }),
  );
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = w * 2;
    canvas.height = h * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    canvas.toBlob((b) => {
      if (b) saveBlobAsFile(b, `${name}.png`);
    }, "image/png");
  };
  img.src = url;
}

/**
 * ChatBI rich result: chart / table toggle (chart first), bar/line/pie switch,
 * PNG + Excel export, and the executed SQL pinned to the bottom.
 */
export default function ResultBlock({
  result,
  chart,
}: {
  result?: ChatResult;
  chart?: EChartOption[];
}) {
  const { t } = useTranslation();
  const hasChart = (chart?.length ?? 0) > 0;
  const hasTable = (result?.df?.length ?? 0) > 0;
  const [view, setView] = useState<"chart" | "table">("table");
  const [viewTouched, setViewTouched] = useState(false);
  useEffect(() => {
    if (hasChart && !viewTouched) setView("chart");
  }, [hasChart, viewTouched]);
  const [chartType, setChartType] = useState<ChartKind>("bar");
  const chartRef = useRef<HTMLDivElement>(null);
  const isDark =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches;

  const columns = useMemo(() => {
    const first = result?.df?.[0];
    if (!first) return [];
    return Object.keys(first).map((k) => ({
      title: k,
      dataIndex: k,
      key: k,
      ellipsis: true,
    }));
  }, [result]);

  if (!hasChart && !hasTable && !result?.sql?.length) return null;

  const sqlText = (result?.sql ?? []).join("\n\n") || result?.last_sql || "";

  return (
    <div>
      <div className={styles.resultToolbar}>
        {hasChart && hasTable ? (
          <PillSegmented
            value={view}
            onChange={(v) => {
              setViewTouched(true);
              setView(v);
            }}
            options={[
              {
                label: t("onemind.chat.chartView"),
                value: "chart",
                icon: <BarChart3 size={13} />,
              },
              {
                label: t("onemind.chat.tableView"),
                value: "table",
                icon: <Table2 size={13} />,
              },
            ]}
          />
        ) : null}
        {hasChart && view === "chart" ? (
          <>
            <span className={styles.toolbarDivider} />
            <PillSegmented
              value={chartType}
              onChange={setChartType}
              options={[
                {
                  label: t("onemind.chat.chartBar"),
                  value: "bar",
                  icon: <BarChart3 size={13} />,
                },
                {
                  label: t("onemind.chat.chartLine"),
                  value: "line",
                  icon: <LineChart size={13} />,
                },
                {
                  label: t("onemind.chat.chartPie"),
                  value: "pie",
                  icon: <PieChart size={13} />,
                },
              ]}
            />
            <span className={styles.toolbarDivider} />
            <ToolButton
              icon={<ImageIcon size={13} />}
              onClick={() =>
                exportChartPng(chartRef.current, t("onemind.chat.chartView"))
              }
            >
              {t("onemind.chat.exportImage")}
            </ToolButton>
          </>
        ) : null}
        {hasTable ? (
          <ToolButton
            icon={<Download size={13} />}
            onClick={() => {
              const ws = XLSX.utils.json_to_sheet(result?.df ?? []);
              const wb = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(wb, ws, "result");
              XLSX.writeFile(wb, `${t("onemind.chat.dataTable")}.xlsx`);
            }}
          >
            {t("onemind.chat.exportExcel")}
          </ToolButton>
        ) : null}
      </div>

      {hasChart && view === "chart" ? (
        <div ref={chartRef}>
          <ChartView option={chart ?? []} chartType={chartType} />
        </div>
      ) : null}

      {hasTable && view === "table" ? (
        <div>
          <Typography.Text type="secondary">
            {t("onemind.chat.dataTable")} ·{" "}
            {t("onemind.chat.rows", {
              count: result?.result_total_rows ?? result?.df.length ?? 0,
            })}
            {result?.result_truncated
              ? ` · ${t("onemind.chat.truncated")}`
              : ""}
          </Typography.Text>
          <Table
            size="small"
            rowKey={(_, i) => String(i)}
            columns={columns}
            dataSource={result?.df ?? []}
            pagination={{ pageSize: 10, size: "small" }}
            scroll={{ x: "max-content" }}
          />
        </div>
      ) : null}

      {sqlText ? (
        <div className={styles.sqlBlock}>
          <Typography.Text type="secondary">
            {t("onemind.chat.executedSql")}
          </Typography.Text>
          <HighlightedCode language="sql" code={sqlText} isDark={!!isDark} />
        </div>
      ) : null}
    </div>
  );
}
