import type { ReactNode } from "react";

/**
 * Renders a Blog Manager article body. The text is plain text by design (see blog_posts.content): a blank line
 * starts a paragraph, "## " starts a sub-heading and consecutive "- " lines form a bullet list. Everything is
 * output as React text nodes, so nothing an admin types can inject HTML or scripts into the page.
 */
export function BlogContent({ content }: { content: string }) {
  const blocks = content.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const out: ReactNode[] = [];
  blocks.forEach((block, i) => {
    if (block.startsWith("## ")) {
      const [heading, ...rest] = block.split("\n");
      out.push(
        <h2 key={`h${i}`} className="pt-3 font-serif text-2xl font-bold leading-snug text-rz-navy">
          {heading.slice(3).trim()}
        </h2>
      );
      if (rest.length) out.push(<Paragraphs key={`hr${i}`} lines={rest} />);
      return;
    }
    const lines = block.split("\n");
    if (lines.every((l) => /^[-*]\s+/.test(l.trim()))) {
      out.push(
        <ul key={`u${i}`} className="list-disc space-y-2 pl-6 text-[16px] leading-[1.8] text-rz-text">
          {lines.map((l, j) => (
            <li key={j}>{l.trim().replace(/^[-*]\s+/, "")}</li>
          ))}
        </ul>
      );
      return;
    }
    out.push(<Paragraphs key={`p${i}`} lines={lines} />);
  });
  return <div className="space-y-5">{out}</div>;
}

function Paragraphs({ lines }: { lines: string[] }) {
  return <p className="whitespace-pre-line text-[16px] leading-[1.85] text-rz-text">{lines.join("\n")}</p>;
}
