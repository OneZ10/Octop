import { useCallback, useEffect, useState } from "react";
import { Button, Segmented, Spin } from "antd";
import { FileText, RotateCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  getOnemindDocPreview,
  type OnemindDocPreview,
} from "../../../api/modules/onemindChat";
import DocumentPreviewCore from "../../../components/DocumentPreviewCore";
import Markdown from "../../../components/Markdown";
import { getDocKind } from "../../../utils/docKind";
import styles from "./OnemindDoc.module.less";

/**
 * Source-document viewer for OneMind knowledge citations. Reuses the Octop
 * chat dock document shell (resize / drag / popup geometry live in the dock).
 *
 * When the citation carries a platform doc_id, the default view is the
 * MinerU-converted original file (docx/doc → PDF, native PDF re-rendered,
 * xlsx native) fetched through the Octop proxy and rendered with the shared
 * DocumentPreviewCore viewer. The aggregated citation text stays available
 * as a secondary "text" view and as the only view for legacy turns without
 * a doc_id.
 */
export default function OnemindDocPanelContent({
  docName,
  content,
  platformDocId,
}: {
  docName: string;
  content: string;
  platformDocId?: string;
}) {
  const { t } = useTranslation();
  const ext = (docName.split(".").pop() || "").toLowerCase();
  const [view, setView] = useState<"original" | "text">(
    platformDocId ? "original" : "text",
  );
  const [preview, setPreview] = useState<OnemindDocPreview | null>(null);
  const [loading, setLoading] = useState(Boolean(platformDocId));
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!platformDocId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getOnemindDocPreview(platformDocId)
      .then((p) => {
        if (!cancelled) setPreview(p);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [platformDocId, nonce]);

  const fileUrl = preview?.file_url;
  const fetchBlob = useCallback(
    async (
      _onProgress?: (loaded: number, total: number) => void,
      signal?: AbortSignal,
    ) => {
      if (!fileUrl) throw new Error("preview URL unavailable");
      const resp = await fetch(fileUrl, { signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.blob();
    },
    [fileUrl],
  );

  const kind = preview
    ? getDocKind(preview.preview_file_extension.replace(/^\./, ""))
    : null;
  const previewName =
    preview && preview.preview_file_extension
      ? docName.replace(/\.[^.]+$/, "") + preview.preview_file_extension
      : docName;

  const openOriginal = useCallback(() => {
    if (fileUrl) window.open(fileUrl, "_blank", "noopener");
  }, [fileUrl]);

  const renderOriginal = () => {
    if (loading) {
      return (
        <div className={styles.stateBox}>
          <Spin />
          <p>{t("onemind.chat.docPreviewLoading")}</p>
        </div>
      );
    }
    if (error) {
      return (
        <div className={styles.stateBox}>
          <p>{t("onemind.chat.docPreviewError")}</p>
          <p className={styles.stateDetail}>{error}</p>
          <Button size="small" onClick={() => setNonce((n) => n + 1)}>
            {t("onemind.chat.docPreviewRefresh")}
          </Button>
        </div>
      );
    }
    if (preview && kind) {
      return (
        <div className={styles.fill}>
          <DocumentPreviewCore
            kind={kind}
            filename={previewName}
            fetchBlob={fetchBlob}
            onDownload={openOriginal}
          />
        </div>
      );
    }
    if (preview?.md_content) {
      return (
        <div className={styles.scroll}>
          <div className={styles.paper}>
            <Markdown content={preview.md_content} />
          </div>
        </div>
      );
    }
    return (
      <div className={styles.stateBox}>
        <p>{t("onemind.chat.docPreviewUnsupported")}</p>
        {fileUrl ? (
          <Button size="small" onClick={openOriginal}>
            {t("onemind.chat.docDownload")}
          </Button>
        ) : null}
      </div>
    );
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <FileText size={15} />
        <span className={styles.name} title={docName}>
          {docName}
        </span>
        {ext ? <span className={styles.badge}>{ext}</span> : null}
        {platformDocId ? (
          <>
            <Segmented
              size="small"
              value={view}
              onChange={(v) => setView(v as "original" | "text")}
              options={[
                {
                  label: t("onemind.chat.docViewOriginal"),
                  value: "original",
                },
                { label: t("onemind.chat.docViewText"), value: "text" },
              ]}
            />
            {view === "original" ? (
              <Button
                type="text"
                size="small"
                icon={<RotateCw size={13} />}
                onClick={() => setNonce((n) => n + 1)}
                title={t("onemind.chat.docPreviewRefresh")}
                aria-label={t("onemind.chat.docPreviewRefresh")}
              />
            ) : null}
          </>
        ) : null}
      </div>
      {view === "original" && platformDocId ? (
        renderOriginal()
      ) : (
        <div className={styles.scroll}>
          <div className={styles.paper}>
            <Markdown content={content || ""} />
          </div>
        </div>
      )}
    </div>
  );
}
