import { type ReactNode } from "react";

export function Reading({ source, query = "" }: { source: string; query?: string }) {
  return (
    <div className="max-w-2xl break-words">
      {parseView(source).map((block, index) => {
        if (block.type === "h") {
          const Tag = block.level === 1 ? "h2" : block.level === 2 ? "h3" : "h4";
          const cls =
            block.level === 1
              ? "mt-8 text-3xl leading-tight font-medium first:mt-0"
              : block.level === 2
                ? "mt-6 text-2xl leading-tight font-medium"
                : "mt-5 text-xl leading-tight font-medium";
          return (
            <Tag key={index} className={cls}>
              <Inline text={block.text} query={query} />
            </Tag>
          );
        }
        if (block.type === "ul" || block.type === "ol") {
          const List = block.type === "ul" ? "ul" : "ol";
          return (
            <List
            key={index}
            start={block.type === "ol" ? block.start : undefined}
            className={"mt-4 space-y-1 pl-5 " + (block.type === "ul" ? "list-disc" : "list-decimal")}
          >
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <Inline text={item} query={query} />
                </li>
              ))}
            </List>
          );
        }
        if (block.type === "hr") return <hr key={index} className="my-6 border-line" />;
        if (block.type === "table") {
          const [head, ...body] = block.rows;
          return (
            <div key={index} className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                {head ? (
                  <thead>
                    <tr>
                      {head.map((cell, cellIndex) => (
                        <th key={cellIndex} className="border border-line px-2 py-1 font-medium">
                          <Inline text={cell} query={query} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                ) : null}
                <tbody>
                  {body.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex} className="border border-line px-2 py-1 align-top">
                          <Inline text={cell} query={query} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return (
          <p key={index} className="mt-4 text-pretty">
            <Inline text={block.text} query={query} />
          </p>
        );
      })}
    </div>
  );
}

type ViewBlock =
  | { type: "h"; level: number; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[]; start: number }
  | { type: "table"; rows: string[][] }
  | { type: "hr" };

function parseView(source: string): ViewBlock[] {
  let body = source.replace(/^\uFEFF/, "");
  if (body.startsWith("---\n")) {
    const end = body.indexOf("\n---", 3);
    if (end !== -1) body = body.slice(end + 4);
  }
  body = body.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (!body) return [];
  const blocks: ViewBlock[] = [];
  for (const chunk of body.split(/\n{2,}/)) {
    const lines = chunk
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) continue;
    blocks.push(...consume(lines));
  }
  return blocks;
}

function consume(lines: string[]): ViewBlock[] {
  const blocks: ViewBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line === "---") {
      blocks.push({ type: "hr" });
      index += 1;
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({ type: "h", level: heading[1].length, text: heading[2] });
      index += 1;
      continue;
    }
    if (/^-\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^-\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^-\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      let start = 1;
      while (index < lines.length) {
        const ordered = /^(\d+)\.\s+(.+)$/.exec(lines[index]);
        if (ordered) {
          if (!items.length) start = Number(ordered[1]);
          items.push(ordered[2]);
          index += 1;
          continue;
        }
        if (items.length && !/^(#{1,3}\s|-\s|\d+\.\s|---$|\|)/.test(lines[index])) {
          items[items.length - 1] += ` ${lines[index]}`;
          index += 1;
          continue;
        }
        break;
      }
      blocks.push({ type: "ol", items, start });
      continue;
    }
    if (/^\|/.test(line)) {
      const rows: string[][] = [];
      while (index < lines.length && /^\|/.test(lines[index])) {
        if (!isTableRule(lines[index])) rows.push(splitCells(lines[index]));
        index += 1;
      }
      if (rows.length) blocks.push({ type: "table", rows });
      continue;
    }
    const para = [line];
    index += 1;
    while (index < lines.length && !/^(#{1,3}\s|-\s|\d+\.\s|---$|\|)/.test(lines[index])) {
      para.push(lines[index]);
      index += 1;
    }
    blocks.push({ type: "p", text: para.join(" ") });
  }
  return blocks;
}

function isTableRule(line: string): boolean {
  return /^\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?$/.test(line);
}

function splitCells(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function highlightRegex(query: string): RegExp | null {
  const stripped = query.normalize("NFD").replace(/\p{M}/gu, "").trim();
  if (stripped.length < 3) return null;
  const body = [...stripped]
    .map((ch) => {
      const escaped = ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return /[a-z0-9]/i.test(ch) ? `${escaped}\\p{M}*` : escaped;
    })
    .join("");
  return new RegExp(body, "giu");
}

function Inline({ text, query }: { text: string; query: string }) {
  const re = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)|\*\*([^*\n]+)\*\*/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text))) {
    if (match.index > last) nodes.push(<Highlight key={key++} text={text.slice(last, match.index)} query={query} />);
    if (match[1] && match[2]) {
      nodes.push(
        <a key={key++} href={match[2]} className="text-accent underline underline-offset-2" target="_blank" rel="noreferrer">
          {unescapeMd(match[1])}
        </a>,
      );
    } else if (match[3]) {
      nodes.push(
        <strong key={key++} className="font-medium">
          <Highlight text={match[3]} query={query} />
        </strong>,
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(<Highlight key={key++} text={text.slice(last)} query={query} />);
  return <>{nodes}</>;
}

function Highlight({ text, query }: { text: string; query: string }) {
  const source = unescapeMd(text);
  const re = highlightRegex(query);
  if (!re) return <>{source}</>;
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of source.matchAll(re)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(<span key={key++}>{source.slice(last, index)}</span>);
    nodes.push(
      <mark key={key++} className="rounded-sm bg-accent/25 text-fg">
        {match[0]}
      </mark>,
    );
    last = index + match[0].length;
  }
  if (!nodes.length) return <>{source}</>;
  if (last < source.length) nodes.push(<span key={key++}>{source.slice(last)}</span>);
  return <>{nodes}</>;
}

function unescapeMd(value: string): string {
  return value.replace(/\\([\\`*_{}[\]#<>])/g, "$1");
}
