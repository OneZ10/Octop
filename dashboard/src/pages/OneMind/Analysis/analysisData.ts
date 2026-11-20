/**
 * Static content for the OneMind intelligent-analysis page (T9), reproduced
 * from the platform "智能分析" page (see watchers/octop/T9-analysis-material.md).
 * Bilingual data lives here (not in locale JSON) to keep the large descriptive
 * copy out of the i18n parity surface. Module 7 copy is corrected from the
 * platform's accidental duplicate of module 4.
 */

export interface Bilingual {
  zh: string;
  en: string;
}

export interface AnalysisModule {
  id: string;
  title: Bilingual;
  points: { zh: string[]; en: string[] };
}

export interface AnalysisDashboard {
  id: string;
  title: Bilingual;
  perspective: Bilingual;
  points: { zh: string[]; en: string[] };
}

export const ANALYSIS_MODULES: AnalysisModule[] = [
  {
    id: "progress",
    title: { zh: "工程进度智能分析", en: "Schedule Progress Analysis" },
    points: {
      zh: [
        "聚焦项目进度管控",
        "精准把控进度偏差与节点风险",
        "助力多项目统筹推进",
      ],
      en: [
        "Focus on project schedule control",
        "Track schedule deviation and milestone risk",
        "Coordinate multiple projects",
      ],
    },
  },
  {
    id: "quality",
    title: { zh: "质量管控智能分析", en: "Quality Control Analysis" },
    points: {
      zh: [
        "围绕工程质量核心",
        "统计分析质量数据",
        "复盘通病隐患",
        "强化质量闭环管控",
      ],
      en: [
        "Centered on engineering quality",
        "Statistical analysis of quality data",
        "Review common defects and hidden risks",
        "Strengthen closed-loop quality control",
      ],
    },
  },
  {
    id: "safety",
    title: { zh: "安全生产智能分析", en: "Safety Production Analysis" },
    points: {
      zh: ["聚焦施工现场安全", "分类统计隐患、预警风险点", "筑牢安全生产防线"],
      en: [
        "Focus on construction site safety",
        "Classify hazards and warn on risk points",
        "Reinforce the safety production line",
      ],
    },
  },
  {
    id: "personnel",
    title: { zh: "监理人员履职分析", en: "Supervisor Performance Analysis" },
    points: {
      zh: ["量化监理人员工作表现", "分析履职情况与效能", "赋能管理效率"],
      en: [
        "Quantify supervisor work performance",
        "Analyze duty fulfillment and efficiency",
        "Empower management efficiency",
      ],
    },
  },
  {
    id: "contract",
    title: {
      zh: "合同与造价投资分析",
      en: "Contract & Cost Investment Analysis",
    },
    points: {
      zh: [
        "工程变更、签证频次及金额分析",
        "价超概算、超预算预警",
        "工程款支付、进度款匹配度分析",
        "索赔、洽商事项统计与风险分析",
      ],
      en: [
        "Change orders and visa frequency / amount analysis",
        "Over-estimate and over-budget warnings",
        "Payment and progress-payment matching analysis",
        "Claim and negotiation statistics and risk analysis",
      ],
    },
  },
  {
    id: "inspection",
    title: { zh: "现场巡检与问题台账", en: "Site Inspection & Issue Ledger" },
    points: {
      zh: [
        "日常巡检问题自动分类/分级统计",
        "问题高发楼栋·高发工序·高发班组分析",
        "问题闭环周期、未销项问题预警",
      ],
      en: [
        "Auto classify / grade routine inspection issues",
        "Analyze high-issue buildings, processes and crews",
        "Issue closure cycle and open-item warnings",
      ],
    },
  },
  {
    id: "document",
    title: { zh: "资料文档合规分析", en: "Document Compliance Analysis" },
    points: {
      zh: [
        "量化资料文档合规性",
        "筛查归档完整性与缺项",
        "分析报审报验时效",
        "赋能文档闭环管理",
      ],
      en: [
        "Quantify document compliance",
        "Screen archive completeness and missing items",
        "Analyze submission and inspection timeliness",
        "Empower closed-loop document management",
      ],
    },
  },
  {
    id: "risk",
    title: { zh: "项目风险智能研判", en: "Project Risk Assessment" },
    points: {
      zh: [
        "质量/安全/进度/造价风险四维评级",
        "天气-工期-劳务-材料供应关联风险预判",
        "在建项目风险等级红黄绿三色预警",
        "风险成因拆解及监理管控建议",
      ],
      en: [
        "Four-dimension risk rating: quality / safety / schedule / cost",
        "Weather-schedule-labor-material correlated risk prediction",
        "Red / amber / green risk-level warnings for active projects",
        "Risk cause breakdown and supervision control advice",
      ],
    },
  },
  {
    id: "enterprise",
    title: {
      zh: "企业经营 & 多项目宏观",
      en: "Enterprise Operations & Macro View",
    },
    points: {
      zh: [
        "监项目分布/区域产值分析",
        "监理服务满意度 & 投诉舆情分析",
        "年度/季度监理工作数据看板",
      ],
      en: [
        "Project distribution / regional output analysis",
        "Service satisfaction and complaint sentiment analysis",
        "Annual / quarterly supervision data dashboard",
      ],
    },
  },
];

export const ANALYSIS_DASHBOARDS: AnalysisDashboard[] = [
  {
    id: "operations",
    title: { zh: "经营宏微观驾驶舱", en: "Operations Cockpit" },
    perspective: { zh: "管理视角", en: "Management" },
    points: {
      zh: [
        "在查项目总量、区域分布、业态分布",
        "营收产值、合同额、回款、毛利分析",
        "分公司/项目部业绩排名、负荷饱和度",
        "年度/季度经营趋势、新拓项目研判",
        "客户履约、投诉、满意度统计",
      ],
      en: [
        "Active project count, regional and business-type distribution",
        "Revenue, contract value, collection and gross margin analysis",
        "Branch / project-team performance ranking and load saturation",
        "Annual / quarterly trends and new-project assessment",
        "Client fulfillment, complaints and satisfaction statistics",
      ],
    },
  },
  {
    id: "project",
    title: { zh: "项目管控驾驶舱", en: "Project Control Cockpit" },
    perspective: { zh: "总监视角", en: "Chief Supervisor" },
    points: {
      zh: [
        "全公司项目进度偏差大盘分析",
        "整体质量通病/不合格项汇总溯源",
        "全公司安全隐患总分/分类/逾期整改分析",
        "危大工程全覆盖监控&风险项目筛查",
        "变更、签证、造价超支集中统计预警",
      ],
      en: [
        "Company-wide schedule deviation overview",
        "Quality defect / nonconformance aggregation and tracing",
        "Safety hazard scoring, classification and overdue rectification",
        "Full coverage of high-risk works and risk-project screening",
        "Change, visa and cost-overrun centralized warnings",
      ],
    },
  },
  {
    id: "staff",
    title: { zh: "人员履职驾驶舱", en: "Staff Performance Cockpit" },
    perspective: { zh: "人力/效能", en: "HR / Efficiency" },
    points: {
      zh: [
        "全员到岗率、驻场时长、出勤分析",
        "旁站/巡视/平行检验履职完成率",
        "人员负荷、项目人均效能排行",
        "岗位持证、证书到期、人员资质合规分析",
        "监理工作产出量化(日志/巡检/整改单)",
      ],
      en: [
        "Attendance rate, on-site duration and attendance analysis",
        "Standby / patrol / parallel-inspection completion rate",
        "Staff load and per-capita efficiency ranking",
        "Certification, expiry and qualification compliance analysis",
        "Quantified output (logs / inspections / rectification orders)",
      ],
    },
  },
  {
    id: "compliance",
    title: { zh: "合规风控驾驶舱", en: "Compliance & Risk Cockpit" },
    perspective: { zh: "合规风控", en: "Compliance" },
    points: {
      zh: [
        "全司监理资料完整性、滞后率、缺项筛查",
        "报审、报验、审批流程时效分析",
        "问题闭环时效、重复问题复发率",
        "质量/安全/进度/合规四类风险评级预警",
        "制度执行、巡检频次、整改闭环合规率",
      ],
      en: [
        "Company-wide document completeness, lag rate and missing-item screening",
        "Submission, inspection and approval workflow timeliness",
        "Issue closure timeliness and recurrence rate",
        "Four-category risk rating: quality / safety / schedule / compliance",
        "Policy execution, inspection frequency and rectification compliance rate",
      ],
    },
  },
];
