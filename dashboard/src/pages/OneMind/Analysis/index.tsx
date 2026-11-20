import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, Segmented, Tag, Typography, message } from "antd";
import { FileText } from "lucide-react";
import PageShell from "../../../layouts/PageShell";
import { ANALYSIS_DASHBOARDS, ANALYSIS_MODULES } from "./analysisData";

const { Paragraph } = Typography;

type AnalysisTab = "reports" | "dashboards";

/** OneMind intelligent analysis (T9): static reproduction of the platform page. */
export default function OneMindAnalysisPage() {
  const { t, i18n } = useTranslation();
  const lang: "zh" | "en" = i18n.language?.startsWith("zh") ? "zh" : "en";
  const [tab, setTab] = useState<AnalysisTab>("reports");

  const gridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
    gap: 16,
  };

  const reportButton = (
    <Button
      size="small"
      icon={<FileText size={14} />}
      onClick={() => message.info(t("onemind.staticPreview"))}
    >
      {t("onemind.generateReport")}
    </Button>
  );

  return (
    <PageShell
      title={t("onemind.analysisTitle")}
      subtitle={t("onemind.analysisSubtitle")}
      actions={
        <Segmented
          value={tab}
          onChange={(v) => setTab(v as AnalysisTab)}
          options={[
            { value: "reports", label: t("onemind.tabReports") },
            { value: "dashboards", label: t("onemind.tabDashboards") },
          ]}
        />
      }
    >
      {tab === "reports" ? (
        <div style={gridStyle}>
          {ANALYSIS_MODULES.map((m) => (
            <Card key={m.id} size="small" title={m.title[lang]}>
              <ul style={{ margin: "0 0 12px", paddingInlineStart: 18 }}>
                {m.points[lang].map((p) => (
                  <li
                    key={p}
                    style={{
                      fontSize: 13,
                      color: "var(--fn-text-secondary)",
                      lineHeight: 1.7,
                    }}
                  >
                    {p}
                  </li>
                ))}
              </ul>
              {reportButton}
            </Card>
          ))}
        </div>
      ) : (
        <div style={gridStyle}>
          {ANALYSIS_DASHBOARDS.map((d) => (
            <Card
              key={d.id}
              size="small"
              title={d.title[lang]}
              extra={<Tag color="processing">{d.perspective[lang]}</Tag>}
            >
              <ul style={{ margin: "0 0 12px", paddingInlineStart: 18 }}>
                {d.points[lang].map((p) => (
                  <li
                    key={p}
                    style={{
                      fontSize: 13,
                      color: "var(--fn-text-secondary)",
                      lineHeight: 1.7,
                    }}
                  >
                    {p}
                  </li>
                ))}
              </ul>
              {reportButton}
            </Card>
          ))}
        </div>
      )}
      <Paragraph
        type="secondary"
        style={{ fontSize: 12, marginTop: 16, marginBottom: 0 }}
      >
        {t("onemind.staticPreview")}
      </Paragraph>
    </PageShell>
  );
}
