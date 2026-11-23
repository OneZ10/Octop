import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Segmented, Typography } from "antd";
import PageShell from "../../../layouts/PageShell";
import { ANALYSIS_DASHBOARDS, ANALYSIS_MODULES } from "./analysisData";
import styles from "./Analysis.module.less";

const { Paragraph } = Typography;

type AnalysisTab = "reports" | "dashboards";

const asset = (name: string) => `${import.meta.env.BASE_URL}onemind/${name}`;

/**
 * OneMind intelligent analysis (T9): reproduces the platform 8801 page, including
 * its per-card illustration backgrounds and overlaid title / bullet textbox.
 * Report modules use analysis-bg-1..9; cockpits use dashboard-bg-1..4.
 */
export default function OneMindAnalysisPage() {
  const { t, i18n } = useTranslation();
  const lang: "zh" | "en" = i18n.language?.startsWith("zh") ? "zh" : "en";
  const [tab, setTab] = useState<AnalysisTab>("reports");

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
        <div className={`${styles.grid} ${styles.reportGrid}`}>
          {ANALYSIS_MODULES.map((m, i) => (
            <div
              key={m.id}
              className={`${styles.card} ${styles.reportCard}`}
              style={{
                backgroundImage: `url(${asset(`analysis-bg-${i + 1}.png`)})`,
              }}
            >
              <div className={`${styles.textbox} ${styles.reportTextbox}`}>
                <div className={styles.reportTitle}>{m.title[lang]}</div>
                <div className={styles.reportContent}>
                  {m.points[lang].map((p) => (
                    <div key={p} className={styles.row}>
                      <span className={styles.spot}>·</span>
                      <span className={styles.contentText}>{p}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={`${styles.grid} ${styles.dashboardGrid}`}>
          {ANALYSIS_DASHBOARDS.map((d, i) => (
            <div
              key={d.id}
              className={`${styles.card} ${styles.dashboardCard}`}
              style={{
                backgroundImage: `url(${asset(`dashboard-bg-${i + 1}.png`)})`,
              }}
            >
              <div className={`${styles.textbox} ${styles.dashboardTextbox}`}>
                <div className={styles.dashboardTitle}>{d.title[lang]}</div>
                <div className={styles.dashboardTag}>{d.perspective[lang]}</div>
                <div className={styles.dashboardContent}>
                  {d.points[lang].map((p) => (
                    <div key={p} className={styles.row}>
                      <span className={styles.spot}>-</span>
                      <span className={styles.contentText}>{p}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <Paragraph className={styles.note} style={{ marginBottom: 0 }}>
        {t("onemind.staticPreview")}
      </Paragraph>
    </PageShell>
  );
}
