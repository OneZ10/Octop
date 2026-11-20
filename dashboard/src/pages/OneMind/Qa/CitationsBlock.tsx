import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "antd";
import cx from "classnames";
import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import chatStyles from "../../Chat/index.module.less";
import panelStyles from "../../Chat/components/KnowledgeCitationPanelContent.module.less";
import styles from "./qa.module.less";
import type { Citation } from "./types";

export interface SourceDoc {
  docId: string;
  docName: string;
  content: string;
}

/** Group citation chunks by source document and rebuild readable source text. */
export function groupCitations(citations: Citation[]): SourceDoc[] {
  const byDoc = new Map<string, Citation[]>();
  for (const c of citations) {
    const name = c.doc_name || "unknown";
    const list = byDoc.get(name) ?? [];
    list.push(c);
    byDoc.set(name, list);
  }
  const docs: SourceDoc[] = [];
  for (const [name, chunks] of byDoc) {
    const sorted = [...chunks].sort(
      (a, b) => (a.position ?? 0) - (b.position ?? 0),
    );
    const content = sorted
      .map((c) => c.content)
      .filter(Boolean)
      .join("\n\n");
    docs.push({ docId: name, docName: name, content });
  }
  return docs;
}

/**
 * Citation tag strip: clamped to two rows by default, expandable to a full
 * multi-row grid. Clicking a tag opens the aggregated source document in the
 * shared chat dock (Octop file-browse shell).
 */
export default function CitationsBlock({
  citations,
  onOpenDoc,
}: {
  citations: Citation[];
  onOpenDoc: (doc: SourceDoc) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const docs = useMemo(() => groupCitations(citations), [citations]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) setOverflow(el.scrollHeight - el.clientHeight > 2);
  }, [citations, expanded]);

  if (citations.length === 0) return null;

  return (
    <div className={chatStyles.knowledgeCitations}>
      <div className={chatStyles.knowledgeCitationsLabel}>
        {t("onemind.chat.citations", { count: citations.length })}
      </div>
      <div
        ref={listRef}
        className={cx(
          chatStyles.knowledgeCitationsList,
          !expanded && styles.citationsClamp,
        )}
      >
        {docs.map((doc) => (
          <span key={doc.docId} className={panelStyles.chipHit}>
            <button
              type="button"
              className={chatStyles.knowledgeCitationChip}
              onClick={() => onOpenDoc(doc)}
            >
              <FileText size={13} strokeWidth={2} aria-hidden />
              <span className={chatStyles.knowledgeCitationName}>
                {doc.docName}
              </span>
            </button>
          </span>
        ))}
      </div>
      {overflow || expanded ? (
        <Button type="link" size="small" onClick={() => setExpanded((e) => !e)}>
          {expanded
            ? t("onemind.chat.citationsCollapse")
            : t("onemind.chat.citationsExpand")}
        </Button>
      ) : null}
    </div>
  );
}
