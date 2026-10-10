/** The small slice of Markdown the legal documents use: #/## headings, paragraphs, "- " bullets, **bold**. */
export interface Run {
  text: string;
  bold: boolean;
}

export interface Block {
  kind: "h1" | "h2" | "p" | "li";
  text: Run[];
}

function runs(line: string): Run[] {
  return line
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((part) =>
      part.startsWith("**") && part.endsWith("**") ? { text: part.slice(2, -2), bold: true } : { text: part, bold: false },
    );
}

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const endPara = () => {
    if (para.length) blocks.push({ kind: "p", text: runs(para.join(" ")) });
    para = [];
  };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      endPara();
    } else if (line.startsWith("## ")) {
      endPara();
      blocks.push({ kind: "h2", text: runs(line.slice(3)) });
    } else if (line.startsWith("# ")) {
      endPara();
      blocks.push({ kind: "h1", text: runs(line.slice(2)) });
    } else if (line.startsWith("- ")) {
      endPara();
      blocks.push({ kind: "li", text: runs(line.slice(2)) });
    } else {
      para.push(line);
    }
  }
  endPara();
  return blocks;
}
