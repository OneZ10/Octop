import type { ChatMessage } from "../../Chat/hooks/sseHelpers";

export interface Citation {
  content: string;
  doc_name: string;
  score?: number;
  segment_id?: string;
  position?: number;
}

export interface ChatResult {
  sql: string[];
  last_sql?: string;
  df: Record<string, unknown>[];
  row_count?: number;
  result_total_rows?: number;
  result_truncated?: boolean;
}

export interface EChartSeries {
  name?: string;
  type?: string;
  valueType?: string;
  data: (number | string)[];
}

export interface EChartOption {
  xAxis?: { data?: (string | number)[] };
  yAxis?: { type?: string; name?: string };
  series?: EChartSeries[];
  title?: { text?: string };
  option_type?: string;
}

export interface TurnExtras {
  citations?: Citation[];
  result?: ChatResult;
  chart?: EChartOption[];
  followups?: string[];
}

export interface Turn {
  id: string;
  user: ChatMessage;
  messages: ChatMessage[];
  extras: TurnExtras;
  streaming: boolean;
}

export type { ChatMessage };
