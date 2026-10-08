import type { ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { slugify } from "@/lib/slug";

/** The words inside an element, for making a heading's address. */
function wordsOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(wordsOf).join("");
  if (node && typeof node === "object" && "props" in node) {
    return wordsOf((node.props as { children?: ReactNode }).children);
  }
  return "";
}

/** A piece of the manual, from Markdown. Tables can be scrolled sideways on a phone. */
export function ManualText({ text }: { text: string }) {
  return (
    <div className="manual-text">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h3: ({ children }) => <h3 id={slugify(wordsOf(children))}>{children}</h3>,
          table: ({ children }) => (
            <div className="table-scroll" tabIndex={0} role="group" aria-label="Table">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
