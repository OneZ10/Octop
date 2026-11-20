import { FileText } from "lucide-react";
import Markdown from "../../../components/Markdown";
import styles from "./OnemindDoc.module.less";

/**
 * Source-document viewer for OneMind knowledge citations. Reuses the Octop
 * chat dock document shell (resize / drag / popup geometry live in the dock).
 * Renders the aggregated full source text of the referenced document as a
 * paper-like page (title + file-type badge), not as chat markdown fragments.
 * Original binary (pdf/docx) preview requires a platform admin file API that
 * the site app key does not expose; the reconstructed source text is shown.
 */
export default function OnemindDocPanelContent({
  docName,
  content,
}: {
  docName: string;
  content: string;
}) {
  const ext = (docName.split(".").pop() || "").toLowerCase();
  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <FileText size={15} />
        <span className={styles.name} title={docName}>
          {docName}
        </span>
        {ext ? <span className={styles.badge}>{ext}</span> : null}
      </div>
      <div className={styles.scroll}>
        <div className={styles.paper}>
          <Markdown content={content || ""} />
        </div>
      </div>
    </div>
  );
}
