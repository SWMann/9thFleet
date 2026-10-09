import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { calloutLabel, isOutside, safeHref, splitTimes, type Block, type CalloutKind, type Inline, type MentionKind } from "@/lib/rich/format";
import { parseRich } from "@/lib/rich/markdown";
import { ZuluTime } from "./ZuluTime";

/**
 * Formatted text, shown to its reader.
 *
 * Every element here is one this file chose to draw. Nothing the writer typed
 * is ever put on the page as HTML, a link is only followed if it is to this
 * site, to a web page or to an email address, and there are no pictures.
 */

type Options = {
  /** The day a time in the text belongs to, such as the start of the event it is in. */
  day?: string;
  /** The reader, so that a mention of them stands out. */
  you?: string | null;
  /** Whether a mention links to the order of battle. Not on a page that visitors can read. */
  mentions?: boolean;
  /**
   * The serving members by id, as the fleet's own records name them. Given
   * this, a member who is named is shown by their real name, whatever was
   * typed, and a name that points at nobody serving is only words.
   */
  members?: Record<string, string>;
  /** The level of a heading in the text. One under it is a level lower. */
  heading?: 3 | 4 | 5;
};

const calloutIcons: Record<CalloutKind, IconName> = { warning: "warning", note: "info", codeword: "radio" };

/** Where a mention leads: the order of battle, at the member, unit or post it names. */
const mentionHref = (kind: MentionKind, id: string) => `/order-of-battle#${kind}-${id}`;

function inline(nodes: Inline[], options: Options): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return splitTimes(node.value).map((piece, at) =>
          typeof piece === "string" ? piece : <ZuluTime key={`${index}-${at}`} text={piece.text} hour={piece.hour} minute={piece.minute} day={options.day} />,
        );
      case "break":
        return <br key={index} />;
      case "strong":
        return <strong key={index}>{inline(node.children, options)}</strong>;
      case "emphasis":
        return <em key={index}>{inline(node.children, options)}</em>;
      case "delete":
        return <del key={index}>{inline(node.children, options)}</del>;
      case "code":
        return <code key={index}>{node.value}</code>;
      case "link": {
        const href = safeHref(node.href);
        if (!href) return <span key={index}>{inline(node.children, options)}</span>;
        return isOutside(href) ? (
          <a key={index} href={href} target="_blank" rel="noopener noreferrer nofollow">
            {inline(node.children, options)}
          </a>
        ) : (
          <a key={index} href={href}>
            {inline(node.children, options)}
          </a>
        );
      }
      case "mention": {
        if (options.mentions === false) return <span key={index}>{node.label}</span>;
        const known = node.kind === "member" && options.members ? options.members[node.id] : undefined;
        // Someone who is not a serving member is not linked to, and not picked out as the reader.
        if (node.kind === "member" && options.members && known === undefined) return <span key={index}>@{node.label}</span>;
        const classes = `mention mention-${node.kind}${node.kind === "member" && options.you && node.id === options.you ? " mention-you" : ""}`;
        return (
          <a key={index} className={classes} href={mentionHref(node.kind, node.id)}>
            @{known ?? node.label}
          </a>
        );
      }
    }
  });
}

function blocks(list: Block[], options: Options): ReactNode[] {
  const top = options.heading ?? 4;
  return list.map((block, index) => {
    switch (block.type) {
      case "paragraph":
        return <p key={index}>{inline(block.children, options)}</p>;
      case "heading": {
        const Tag = `h${Math.min(6, top + block.level - 1)}` as "h3" | "h4" | "h5" | "h6";
        return (
          <Tag key={index} className={`rich-heading rich-heading-${block.level}`}>
            {inline(block.children, options)}
          </Tag>
        );
      }
      case "list": {
        const items = block.items.map((item, at) => (
          // A plain item is its words. One that holds more keeps its paragraphs.
          <li key={at}>{item.length === 1 && item[0].type === "paragraph" ? inline(item[0].children, options) : blocks(item, options)}</li>
        ));
        return block.ordered ? (
          <ol key={index} start={block.start === 1 ? undefined : block.start}>
            {items}
          </ol>
        ) : (
          <ul key={index}>{items}</ul>
        );
      }
      case "quote":
        return <blockquote key={index}>{blocks(block.children, options)}</blockquote>;
      case "callout":
        return (
          <aside key={index} className={`callout callout-${block.kind}`}>
            <p className="callout-label">
              <Icon name={calloutIcons[block.kind]} size={16} />
              {calloutLabel(block.kind)}
            </p>
            {blocks(block.children, options)}
          </aside>
        );
      case "rule":
        return <hr key={index} />;
    }
  });
}

/** A piece of formatted text. Nothing is drawn when there is nothing written. */
export function Rich({ text, className, ...options }: Options & { text: string | null | undefined; className?: string }) {
  const tree = parseRich(text);
  if (tree.length === 0) return null;
  return <div className={className ? `rich ${className}` : "rich"}>{blocks(tree, options)}</div>;
}

/**
 * Formatted text that sits inside a line of the page's own: a role's summary
 * under its name, say. Only what fits in a line is drawn. Paragraphs run on,
 * and a list or a box is read as its words.
 */
export function RichLine({ text, ...options }: Omit<Options, "mentions" | "members"> & { text: string | null | undefined }) {
  const flat: Inline[] = [];
  const walk = (list: Block[]) => {
    for (const block of list) {
      if (block.type === "paragraph" || block.type === "heading") {
        if (flat.length > 0) flat.push({ type: "text", value: " " });
        flat.push(...block.children.map((node): Inline => (node.type === "break" ? { type: "text", value: " " } : node)));
      } else if (block.type === "list") block.items.forEach(walk);
      else if (block.type === "quote" || block.type === "callout") walk(block.children);
    }
  };
  walk(parseRich(text));
  // In a line of the page nobody is linked to, whatever is asked for: these lines are on pages visitors read.
  return <>{inline(flat, { ...options, mentions: false })}</>;
}
