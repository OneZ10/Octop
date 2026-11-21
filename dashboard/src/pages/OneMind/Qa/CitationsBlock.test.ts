import { describe, expect, it } from "vitest";
import { groupCitations } from "./CitationsBlock";
import type { Citation } from "./types";

const chunk = (over: Partial<Citation>): Citation => ({
  content: "text",
  doc_name: "a.pdf",
  ...over,
});

describe("groupCitations", () => {
  it("groups by platform doc_id and keeps it for original preview", () => {
    const docs = groupCitations([
      chunk({ doc_id: "d1", content: "second", position: 2 }),
      chunk({ doc_id: "d1", content: "first", position: 1 }),
      chunk({ doc_id: "d2", doc_name: "b.docx", content: "other" }),
    ]);
    expect(docs).toHaveLength(2);
    expect(docs[0]).toEqual({
      docId: "d1",
      docName: "a.pdf",
      content: "first\n\nsecond",
      platformDocId: "d1",
    });
    expect(docs[1].platformDocId).toBe("d2");
    expect(docs[1].docName).toBe("b.docx");
  });

  it("falls back to doc_name grouping for legacy citations without doc_id", () => {
    const docs = groupCitations([
      chunk({ content: "x", position: 1 }),
      chunk({ content: "y", position: 2 }),
      chunk({ doc_name: "b.pdf", content: "z" }),
    ]);
    expect(docs).toHaveLength(2);
    expect(docs[0].docId).toBe("a.pdf");
    expect(docs[0].content).toBe("x\n\ny");
    expect(docs[0].platformDocId).toBeUndefined();
  });

  it("separates same-named documents with distinct doc_ids", () => {
    const docs = groupCitations([
      chunk({ doc_id: "d1" }),
      chunk({ doc_id: "d2" }),
    ]);
    expect(docs).toHaveLength(2);
    expect(docs.map((d) => d.docId)).toEqual(["d1", "d2"]);
  });
});
