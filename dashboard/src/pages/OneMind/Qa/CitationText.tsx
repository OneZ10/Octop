import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import styles from "./OnemindDoc.module.less";

/**
 * Citation source text renderer. KB chunks mix markdown with raw HTML tables
 * (MinerU table extraction) and relative image links (``images/<sha>.jpg``);
 * the platform preview supplies a presigned URL per image file name. Render
 * the HTML (sanitized) and rewrite image sources to those absolute URLs.
 */
export default function CitationText({
  content,
  images,
}: {
  content: string;
  images?: Record<string, string>;
}) {
  const text = useMemo(() => {
    if (!images || Object.keys(images).length === 0) return content;
    const resolve = (src: string): string | null => {
      const name = src.split("?")[0].split("/").pop() ?? "";
      return images[name] ?? null;
    };
    return content
      .replace(/(!\[[^\]]*\]\()([^)\s]+)(\))/g, (whole, pre, src, post) => {
        const url = resolve(src);
        return url ? pre + url + post : whole;
      })
      .replace(/(src=")([^"]+)(")/g, (whole, pre, src, post) => {
        const url = resolve(src);
        return url ? pre + url + post : whole;
      });
  }, [content, images]);

  return (
    <div className={styles.citationText}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, defaultSchema]]}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
