import { Extension, mergeAttributes, Node, type Editor, type Range } from "@tiptap/core";
import Code from "@tiptap/extension-code";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { shift } from "@floating-ui/dom";
import { Suggestion } from "@tiptap/suggestion";
import { calloutLabel, callouts, findTimes, isCalloutKind, mentionKinds, type CalloutKind, type MentionKind } from "@/lib/rich/format";
import type { RichSources } from "@/lib/rich/sources";
import type { IconName } from "@/components/Icon";
import { menuOf, type MenuItem } from "./Menu";

/**
 * What the editor can do beyond the usual: call-out boxes, naming a member,
 * unit or post with @, a menu on /, and times in UTC marked as it is typed.
 */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      /** Put the paragraphs chosen in a box of this kind, change the box they are in, or take them out of it. */
      toggleCallout: (kind: CalloutKind) => ReturnType;
    };
  }
}

/** A box around some paragraphs: a warning, a note or a codeword. Its label is drawn by the style sheet, so it cannot be typed over. */
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      kind: {
        default: "note",
        // The kind is one of the three, whatever a page that was pasted from called it.
        parseHTML: (element) => {
          const kind = element.getAttribute("data-callout");
          return isCalloutKind(kind) ? kind : "note";
        },
        renderHTML: (attributes) => {
          const kind: CalloutKind = isCalloutKind(attributes.kind) ? attributes.kind : "note";
          return { "data-callout": kind, "data-label": calloutLabel(kind), class: `callout callout-${kind}` };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "aside[data-callout]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["aside", mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      toggleCallout:
        (kind) =>
        ({ commands, editor }) => {
          if (editor.isActive(this.name, { kind })) return commands.lift(this.name);
          if (editor.isActive(this.name)) return commands.updateAttributes(this.name, { kind });
          return commands.wrapIn(this.name, { kind });
        },
    };
  },
});

const said = (text: string, query: string) => text.toLowerCase().includes(query.trim().toLowerCase());

/** A list is kept on the screen: near the right edge of a phone it moves left instead of running off the side. */
const onScreen = { middleware: [shift({ padding: 8 })] };

const mentionIcons = { member: "person", unit: "ship", post: "flag" } as const;
const mentionGroups = { member: "Members", unit: "Units", post: "Posts" } as const;

const kindOf = (value: unknown): MentionKind => (mentionKinds.includes(value as MentionKind) ? (value as MentionKind) : "member");

/**
 * A member, a unit or a post that is named. It is kept by its id, so it still
 * points at them if the words around it change.
 *
 * Every editor knows what one is, whether or not its page offers anyone to
 * name. Text that names someone can then be opened and edited anywhere with
 * the name kept as it was.
 */
export const MentionNode = Node.create({
  name: "mention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      id: { default: "", parseHTML: (element) => element.getAttribute("data-id") ?? "", renderHTML: (attributes) => ({ "data-id": attributes.id }) },
      label: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-label") ?? "",
        renderHTML: (attributes) => ({ "data-label": attributes.label }),
      },
      kind: {
        default: "member",
        parseHTML: (element) => kindOf(element.getAttribute("data-kind")),
        renderHTML: (attributes) => ({ "data-kind": kindOf(attributes.kind) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-mention]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-mention": "", class: `mention mention-${kindOf(node.attrs.kind)}` }), `@${node.attrs.label}`];
  },

  renderText({ node }) {
    return `@${node.attrs.label}`;
  },
});

type MentionChoice = MenuItem & { attrs: { id: string; label: string; kind: MentionKind } };

/** Naming someone: type @ and choose. Only on a page that offers members, units and posts to name. */
export function mentionMenuFor(sources: () => RichSources) {
  return Extension.create({
    name: "mentionMenu",
    addProseMirrorPlugins() {
      return [
        Suggestion<MentionChoice, MentionChoice>({
          editor: this.editor,
          char: "@",
          pluginKey: new PluginKey("mentionMenu"),
          floatingUi: onScreen,
          items: ({ query }) =>
            sources()
              .mentions.filter((entry) => said(entry.label, query) || said(entry.note ?? "", query))
              .slice(0, 8)
              .map((entry) => ({
                key: `${entry.kind}:${entry.id}`,
                label: entry.label,
                note: entry.note,
                icon: mentionIcons[entry.kind],
                group: mentionGroups[entry.kind],
                attrs: { id: entry.id, label: entry.label, kind: entry.kind },
              })),
          command: ({ editor, range, props }: { editor: Editor; range: Range; props: MentionChoice }) => {
            editor
              .chain()
              .focus()
              .insertContentAt(range, [
                { type: "mention", attrs: props.attrs },
                { type: "text", text: " " },
              ])
              .run();
          },
          render: menuOf<MentionChoice>("Members, units and posts", "Nobody and nothing by that name."),
        }),
      ];
    },
  });
}

/** Code that can sit inside bold, italic or a link, as Markdown lets it. */
export const InlineCode = Code.extend({ excludes: "" });

type SlashChoice = MenuItem & { run: (editor: Editor) => void };

const boxIcons: Record<CalloutKind, IconName> = { warning: "warning", note: "info", codeword: "radio" };

/** Words to put in as words. Given as text, they are never read as HTML, whatever they contain. */
export const words = (text: string) => ({ type: "text", text });

/** A time of day in UTC as the fleet writes it, such as 1930Z. */
const zulu = (at: Date) => `${String(at.getUTCHours()).padStart(2, "0")}${String(at.getUTCMinutes()).padStart(2, "0")}Z`;

/** Everything the / menu offers on this page: ways to lay text out, boxes, and words from the page's own records. */
export function slashChoices(sources: RichSources): SlashChoice[] {
  const start = sources.day ? new Date(sources.day) : null;
  return [
    { key: "heading", group: "Layout", label: "Heading", icon: "flag", run: (editor) => editor.chain().focus().setHeading({ level: 2 }).run() },
    { key: "subheading", group: "Layout", label: "Smaller heading", icon: "flag", run: (editor) => editor.chain().focus().setHeading({ level: 3 }).run() },
    { key: "bullets", group: "Layout", label: "Bullet list", icon: "bullets", run: (editor) => editor.chain().focus().toggleBulletList().run() },
    { key: "numbers", group: "Layout", label: "Numbered list", icon: "numbers", run: (editor) => editor.chain().focus().toggleOrderedList().run() },
    { key: "quote", group: "Layout", label: "Quote", icon: "quote", run: (editor) => editor.chain().focus().toggleBlockquote().run() },
    { key: "rule", group: "Layout", label: "Dividing line", icon: "rule", run: (editor) => editor.chain().focus().setHorizontalRule().run() },
    ...callouts.map(
      (box): SlashChoice => ({
        key: `box-${box.kind}`,
        group: "Boxes",
        label: `${box.label} box`,
        note: box.about,
        icon: boxIcons[box.kind],
        run: (editor) => editor.chain().focus().toggleCallout(box.kind).run(),
      }),
    ),
    {
      key: "time",
      group: "Insert",
      label: start ? "The event's start, in UTC" : "The time now, in UTC",
      note: "Each reader also sees a time like this in their own time.",
      icon: "clock",
      run: (editor) => editor.chain().focus().insertContent(words(`${zulu(start && !Number.isNaN(start.getTime()) ? start : new Date())} `)).run(),
    },
    ...sources.inserts.map(
      (entry, index): SlashChoice => ({
        key: `insert-${index}`,
        group: entry.group,
        label: entry.label,
        note: entry.text === entry.label ? undefined : entry.text,
        icon: "arrow",
        run: (editor) => editor.chain().focus().insertContent(words(`${entry.text} `)).run(),
      }),
    ),
    ...sources.links.map(
      (entry, index): SlashChoice => ({
        key: `link-${index}`,
        group: "Link to the manual",
        label: entry.label,
        note: entry.note,
        icon: "book",
        run: (editor) =>
          editor
            .chain()
            .focus()
            .insertContent([
              { type: "text", text: entry.label, marks: [{ type: "link", attrs: { href: entry.href } }] },
              { type: "text", text: " " },
            ])
            .run(),
      }),
    ),
  ];
}

/** The / menu: type / at the start of a line or after a space, then a few letters to narrow it. */
export function slashFor(sources: () => RichSources) {
  return Extension.create({
    name: "slash",
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashChoice, SlashChoice>({
          editor: this.editor,
          char: "/",
          pluginKey: new PluginKey("slash"),
          floatingUi: onScreen,
          items: ({ query }) => {
            const found = slashChoices(sources()).filter((choice) => said(choice.label, query) || said(choice.group ?? "", query) || said(choice.note ?? "", query));
            // With nothing typed yet, the page's own words and links wait until they are asked for by name.
            return query.trim() === "" ? found.filter((choice) => !choice.key.startsWith("link-")).slice(0, 14) : found.slice(0, 12);
          },
          command: ({ editor, range, props }: { editor: Editor; range: Range; props: SlashChoice }) => {
            editor.chain().focus().deleteRange(range).run();
            props.run(editor);
          },
          render: menuOf<SlashChoice>("Things to add", "Nothing by that name."),
        }),
      ];
    },
  });
}

/** Marks each time in UTC as it is typed, so its writer can see that readers will be given their own time beside it. */
export const ZuluMarks = Extension.create({
  name: "zuluMarks",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("zuluMarks"),
        props: {
          decorations(state) {
            const marks: Decoration[] = [];
            state.doc.descendants((node, position) => {
              if (!node.isText || !node.text) return;
              for (const found of findTimes(node.text)) {
                marks.push(
                  Decoration.inline(position + found.from, position + found.to, {
                    class: "zulu",
                    title: "A time in UTC. Each reader also sees it in their own time.",
                  }),
                );
              }
            });
            return DecorationSet.create(state.doc, marks);
          },
        },
      }),
    ];
  },
});
