import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import CitationText from "./CitationText";

describe("CitationText", () => {
  it("renders raw HTML tables from KB chunks", () => {
    const content =
      '前言\n<table><tr><td colspan="2">D02</td></tr><tr><td>施工内容</td><td>新建顶管</td></tr></table>';
    const { container } = render(<CitationText content={content} />);
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(screen.getByText("施工内容")).toBeInTheDocument();
    expect(screen.getByText("新建顶管")).toBeInTheDocument();
    expect(container.textContent).not.toContain("<table>");
    expect(container.querySelector("td[colspan='2']")).not.toBeNull();
  });

  it("rewrites relative markdown images to presigned URLs", () => {
    const images = {
      "abc.jpg": "http://platform.test/storage/file/x/images/abc.jpg?sig=1",
    };
    const { container } = render(
      <CitationText content="看图 ![](images/abc.jpg) 结束" images={images} />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe(images["abc.jpg"]);
  });

  it("leaves unknown image sources untouched", () => {
    const { container } = render(
      <CitationText content="![](images/missing.jpg)" images={{}} />,
    );
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("images/missing.jpg");
  });

  it("strips script tags from chunk HTML", () => {
    const { container } = render(
      <CitationText
        content={
          "<script>alert(1)</script><table><tr><td>安全</td></tr></table>"
        }
      />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("安全")).toBeInTheDocument();
  });
});
