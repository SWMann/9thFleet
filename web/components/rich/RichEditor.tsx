"use client";

import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { fromDoc, toDoc, type Node } from "@/lib/rich/doc";
import { callouts, safeHref, wordsOf, type CalloutKind } from "@/lib/rich/format";
import { parseRich, writeRich } from "@/lib/rich/markdown";
import { Callout, InlineCode, mentionMenuFor, MentionNode, slashFor, words, ZuluMarks } from "./extensions";
import { useRichSources } from "./RichSources";

/** The plain field the editor stands in for: it stays in the form, and is kept in step. */
export type PlainField = {
  /** What it holds now. */
  read: () => string;
  /** Put the editor's words into it, as Markdown. */
  write: (markdown: string) => void;
  /** The form it is part of. */
  form: () => HTMLFormElement | null;
};

export type RichEditorProps = {
  /** The id the plain field had, which the editor takes over. */
  fieldId: string;
  plain: PlainField;
  /** What the plain field held when the editor arrived. */
  initial: string;
  /** The field's label, which names the editor too. */
  label: { id: string; text: string } | null;
  rows: number;
  maxLength?: number;
  required: boolean;
  line: boolean;
  describedBy?: string;
  /** Called if the editor cannot hold the field's words as they are. The plain field then carries on in its place. */
  onFail: () => void;
};

const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const keys = (combo: string) => (mac ? combo.replace("Ctrl+", "⌘").replace("Shift+", "⇧").replace("Alt+", "⌥") : combo);

/** What the page offers its editors, held so that a menu reads the latest when it opens. */
class Latest<Value> {
  constructor(private value: Value) {}
  get = () => this.value;
  set(value: Value) {
    this.value = value;
  }
}

/**
 * The editor that takes a long text field's place: formatting as it is typed,
 * a bar of tools on the field in use, @ to name someone, / for more.
 *
 * What it holds is written back to the plain field as Markdown when it is
 * changed. Two things keep the stored words safe from the editor itself. If the
 * editor cannot show every word the field held, it steps aside and the plain
 * field carries on. And a field that is only looked at is left exactly as it
 * was stored, not rewritten in the editor's own way of writing the same thing.
 */
export function RichEditor({ fieldId, plain, initial, label, rows, maxLength, required, line, describedBy, onFail }: RichEditorProps) {
  const sources = useRichSources();
  // The editor is made once. It is not made again each time the page is refreshed and hands down the same lists anew.
  const [live] = useState(() => new Latest(sources));
  useEffect(() => live.set(sources), [live, sources]);
  const [length, setLength] = useState(initial.length);
  const [problem, setProblem] = useState<string | null>(null);
  const [used, setUsed] = useState(false);
  const [canName] = useState(!line && sources.mentions.length > 0);
  const [start] = useState(() => toDoc(parseRich(initial), line));
  // What the field held as it was stored, and the same words as the editor writes them. Until the editor has
  // shown that it holds every word, nothing it does is written back.
  const kept = useRef({ original: initial, baseline: "", trusted: false });

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: line ? false : { levels: [2, 3] },
        bulletList: line ? false : undefined,
        orderedList: line ? false : undefined,
        listItem: line ? false : undefined,
        listKeymap: line ? false : undefined,
        blockquote: line ? false : undefined,
        horizontalRule: line ? false : undefined,
        code: false,
        codeBlock: false,
        underline: false,
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          // Only an address the reader's page would follow can be made a link.
          isAllowedUri: (address) => safeHref(address) !== null,
          HTMLAttributes: { rel: "noopener noreferrer nofollow", target: null },
        },
      }),
      InlineCode,
      // Every editor can hold a name that is already in its text. Only some offer names to choose from.
      MentionNode,
      ...(line
        ? []
        : [
            Callout,
            ZuluMarks,
            slashFor(live.get),
            Placeholder.configure({
              placeholder: canName ? "Type / for headings, lists and boxes, and @ to name someone." : "Type / for headings, lists and boxes.",
            }),
          ]),
      ...(canName ? [mentionMenuFor(live.get)] : []),
    ],
    [line, canName, live],
  );

  const editor = useEditor(
    {
      extensions,
      content: start,
      editorProps: {
        attributes: {
          class: "rich rich-input",
          id: fieldId,
          role: "textbox",
          "aria-multiline": "true",
          ...(label ? { "aria-labelledby": label.id } : {}),
          "aria-describedby": [describedBy, `${fieldId}-note`].filter(Boolean).join(" "),
          ...(required ? { "aria-required": "true" } : {}),
          style: `min-height: ${(rows * 1.5 + 1.3).toFixed(1)}em`,
        },
      },
      onUpdate({ editor: changed }) {
        if (!kept.current.trusted) return;
        const written = writeRich(fromDoc(changed.getJSON() as Node));
        // Words that are as they were stored are left as they were stored.
        const out = written === kept.current.baseline ? kept.current.original : written;
        plain.write(out);
        setLength(out.length);
        setProblem(null);
      },
      // The bar comes with the field's first use. A click brings it once the mouse is let go: see below.
      onFocus: () => {
        if (!pressed.current) setUsed(true);
      },
    },
    [extensions],
  );

  // Before anything is written back, the editor shows that it holds every word the field held.
  // If it does not, the field's words are left as they were and the plain field carries on.
  useEffect(() => {
    if (!editor) return;
    const loaded = fromDoc(editor.getJSON() as Node);
    if (wordsOf(loaded) !== wordsOf(parseRich(initial))) {
      plain.write(initial);
      onFail();
      return;
    }
    kept.current = { original: initial, baseline: writeRich(loaded), trusted: true };
  }, [editor, initial, plain, onFail]);

  // The bar is put in above the words, which would push them down from under the pointer. Two things stop that
  // being felt. It waits for the mouse to be let go, so a click is never turned into a drag across the words. And
  // the page is moved by the bar's height in the same breath, so the words stay where they were on the screen.
  const box = useRef<HTMLDivElement>(null);
  const pressed = useRef(false);
  useEffect(() => {
    const element = box.current;
    if (!element || used) return;
    const down = () => {
      pressed.current = true;
    };
    const up = () => {
      if (!pressed.current) return;
      pressed.current = false;
      if (element.contains(document.activeElement)) setUsed(true);
    };
    element.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      element.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [used, editor]);
  useLayoutEffect(() => {
    if (!used) return;
    const bar = box.current?.querySelector<HTMLElement>(".rich-bar");
    if (bar) window.scrollBy({ top: bar.offsetHeight, behavior: "instant" });
  }, [used]);

  // A click on the field's label goes to the editor, as it went to the plain field.
  useEffect(() => {
    const element = label ? document.getElementById(label.id) : null;
    if (!element || !editor) return;
    const focus = (event: MouseEvent) => {
      event.preventDefault();
      editor.commands.focus();
    };
    element.addEventListener("click", focus);
    return () => element.removeEventListener("click", focus);
  }, [label, editor]);

  // The form is stopped if the field is empty and must not be, or holds too much, as the plain field stopped it.
  // And when the form is put back as it was, so is the editor.
  useEffect(() => {
    const form = plain.form();
    if (!form || !editor) return;
    const check = (event: Event) => {
      if (event.target !== form || form.noValidate) return;
      // A button that says not to check the form is taken at its word.
      const by = (event as SubmitEvent).submitter;
      if (by instanceof HTMLButtonElement && by.formNoValidate) return;
      const written = plain.read();
      const over = maxLength !== undefined ? written.length - maxLength : 0;
      const wrong =
        required && written.trim() === ""
          ? "Fill this in."
          : over > 0
            ? `This is ${over.toLocaleString("en-GB")} ${over === 1 ? "character" : "characters"} too long, counting its formatting.`
            : null;
      if (!wrong) return;
      // Of several fields that are wrong, the cursor goes to the first.
      const first = !event.defaultPrevented;
      event.preventDefault();
      event.stopPropagation();
      setProblem(wrong);
      if (first) editor.commands.focus();
    };
    const restore = () => {
      // The plain field is put back first, so read it once that has happened.
      setTimeout(() => {
        if (editor.isDestroyed) return;
        const now = plain.read();
        editor.commands.setContent(toDoc(parseRich(now), line), { emitUpdate: false });
        kept.current = { original: now, baseline: writeRich(fromDoc(editor.getJSON() as Node)), trusted: true };
        setLength(now.length);
        setProblem(null);
      }, 0);
    };
    // Heard on the way down from the window, which is before the page's own handling of the form.
    window.addEventListener("submit", check, true);
    form.addEventListener("reset", restore);
    return () => {
      window.removeEventListener("submit", check, true);
      form.removeEventListener("reset", restore);
    };
  }, [editor, plain, required, maxLength, line]);

  // A field that is wrong says so to a screen reader as well as on the screen.
  const over = maxLength !== undefined && length > maxLength;
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (problem || over) editor.view.dom.setAttribute("aria-invalid", "true");
    else editor.view.dom.removeAttribute("aria-invalid");
  }, [editor, problem, over]);

  if (!editor) return null;
  const near = maxLength !== undefined && length >= maxLength * 0.85;
  return (
    <div className={used ? "rich-editor rich-editor-used" : "rich-editor"} ref={box}>
      {used ? <Bar editor={editor} line={line} canName={canName} controls={fieldId} /> : null}
      <EditorContent editor={editor} />
      {near || problem ? (
        <p className={problem || over ? "rich-count rich-count-over" : "rich-count"} id={`${fieldId}-note`} role={problem ? "alert" : undefined}>
          {problem ?? `${length.toLocaleString("en-GB")} of ${maxLength?.toLocaleString("en-GB")} characters, counting formatting`}
        </p>
      ) : null}
    </div>
  );
}

const boxIcons: Record<CalloutKind, IconName> = { warning: "warning", note: "info", codeword: "radio" };

/** The bar of tools. Each button keeps the cursor where it is in the text. */
function Bar({ editor, line, canName, controls }: { editor: Editor; line: boolean; canName: boolean; controls: string }) {
  const on = useEditorState({
    editor,
    selector: ({ editor: now }) => ({
      bold: now.isActive("bold"),
      italic: now.isActive("italic"),
      strike: now.isActive("strike"),
      heading: now.isActive("heading"),
      bullets: now.isActive("bulletList"),
      numbers: now.isActive("orderedList"),
      quote: now.isActive("blockquote"),
      link: now.isActive("link"),
      box: (now.isActive("callout") ? (now.getAttributes("callout").kind as CalloutKind) : null) as CalloutKind | null,
      undo: now.can().undo(),
      redo: now.can().redo(),
    }),
  });
  const [linking, setLinking] = useState(false);
  const [address, setAddress] = useState("");
  const [refused, setRefused] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const openLink = useCallback(() => {
    setAddress((editor.getAttributes("link").href as string | undefined) ?? "");
    setRefused(false);
    setLinking(true);
    setTimeout(() => input.current?.focus(), 0);
  }, [editor]);
  // Ctrl+K opens the link row, as it does in most editors.
  useEffect(() => {
    const element = editor.view.dom;
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openLink();
      }
    };
    element.addEventListener("keydown", onKey);
    return () => element.removeEventListener("keydown", onKey);
  }, [editor, openLink]);

  const setLink = () => {
    const typed = address.trim();
    // An email address is written to, and a bare web address is taken as one.
    const guess = /^[^@\s/:]+@[^@\s/:]+\.[^@\s/:]+$/.test(typed) ? `mailto:${typed}` : `https://${typed}`;
    const href = safeHref(typed) ?? (typed && !/^[a-z][a-z0-9+.-]*:/i.test(typed) && !typed.startsWith("/") ? safeHref(guess) : null);
    if (!href) {
      setRefused(true);
      return;
    }
    const chain = editor.chain().focus().extendMarkRange("link");
    if (editor.state.selection.empty && !editor.isActive("link")) {
      // With nothing chosen, the address itself is put in as the link's words.
      chain.insertContent([{ type: "text", text: href.replace(/^mailto:/, ""), marks: [{ type: "link", attrs: { href } }] }]).run();
    } else chain.setLink({ href }).run();
    setLinking(false);
  };
  const removeLink = () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinking(false);
  };
  /** Type a character that opens a menu, with a space before it if it would otherwise join a word. */
  const open = (trigger: "@" | "/") => {
    const { $from } = editor.state.selection;
    const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset, undefined, "￼");
    editor
      .chain()
      .focus()
      .insertContent(words(before && before !== " " ? ` ${trigger}` : trigger))
      .run();
  };
  const cycleHeading = () => {
    const chain = editor.chain().focus();
    if (editor.isActive("heading", { level: 2 })) chain.setHeading({ level: 3 }).run();
    else if (editor.isActive("heading", { level: 3 })) chain.setParagraph().run();
    else chain.setHeading({ level: 2 }).run();
  };

  const button = (label: string, pressed: boolean | null, run: () => void, content: React.ReactNode, more: { disabled?: boolean; className?: string } = {}) => (
    <button
      type="button"
      className={more.className ? `rich-tool ${more.className}` : "rich-tool"}
      aria-label={label.replace(/ \(.*\)$/, "")}
      title={label}
      aria-pressed={pressed ?? undefined}
      disabled={more.disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={run}
    >
      {content}
    </button>
  );

  if (linking) {
    return (
      <div className="rich-bar rich-bar-link" role="group" aria-label="Link">
        <input
          ref={input}
          type="text"
          inputMode="url"
          value={address}
          placeholder="https://… or a page of this site, such as /manual"
          aria-label="Link address"
          aria-invalid={refused || undefined}
          onChange={(event) => {
            setAddress(event.target.value);
            setRefused(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              setLink();
            } else if (event.key === "Escape") {
              event.preventDefault();
              setLinking(false);
              editor.commands.focus();
            }
          }}
        />
        <button type="button" className="rich-tool rich-tool-words" onClick={setLink}>
          Set link
        </button>
        {on.link ? (
          <button type="button" className="rich-tool rich-tool-words" onClick={removeLink}>
            Remove
          </button>
        ) : null}
        <button
          type="button"
          className="rich-tool rich-tool-words"
          onClick={() => {
            setLinking(false);
            editor.commands.focus();
          }}
        >
          Cancel
        </button>
        {refused ? (
          <p className="rich-bar-note" role="alert">
            A link goes to a web address, an email address or a page of this site.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rich-bar" role="toolbar" aria-label="Formatting" aria-controls={controls}>
      <span className="rich-tools">
        {button(`Bold (${keys("Ctrl+B")})`, on.bold, () => editor.chain().focus().toggleBold().run(), <b>B</b>)}
        {button(`Italic (${keys("Ctrl+I")})`, on.italic, () => editor.chain().focus().toggleItalic().run(), <i>I</i>)}
        {button(`Strikethrough (${keys("Ctrl+Shift+S")})`, on.strike, () => editor.chain().focus().toggleStrike().run(), <s>S</s>)}
        {button(`Link (${keys("Ctrl+K")})`, on.link, openLink, <Icon name="link" size={18} />)}
      </span>
      {line ? null : (
        <>
          <span className="rich-tools">
            {button("Heading, then a smaller one", on.heading, cycleHeading, <b>H</b>)}
            {button(`Bullet list (${keys("Ctrl+Shift+8")})`, on.bullets, () => editor.chain().focus().toggleBulletList().run(), <Icon name="bullets" size={18} />)}
            {button(`Numbered list (${keys("Ctrl+Shift+7")})`, on.numbers, () => editor.chain().focus().toggleOrderedList().run(), <Icon name="numbers" size={18} />)}
            {button(`Quote (${keys("Ctrl+Shift+B")})`, on.quote, () => editor.chain().focus().toggleBlockquote().run(), <Icon name="quote" size={18} />)}
          </span>
          <span className="rich-tools">
            {callouts.map((box) => (
              <span key={box.kind}>
                {button(`${box.label} box`, on.box === box.kind, () => editor.chain().focus().toggleCallout(box.kind).run(), <Icon name={boxIcons[box.kind]} size={18} />, {
                  className: `rich-tool-${box.kind}`,
                })}
              </span>
            ))}
          </span>
          <span className="rich-tools">
            {canName ? button("Name a member, unit or post (@)", null, () => open("@"), <b>@</b>) : null}
            {button("More to add (/)", null, () => open("/"), <b>/</b>)}
          </span>
        </>
      )}
      <span className="rich-tools rich-tools-end">
        {button(`Undo (${keys("Ctrl+Z")})`, null, () => editor.chain().focus().undo().run(), <Icon name="undo" size={18} />, { disabled: !on.undo })}
        {button(`Redo (${keys("Ctrl+Shift+Z")})`, null, () => editor.chain().focus().redo().run(), <Icon name="redo" size={18} />, { disabled: !on.redo })}
      </span>
    </div>
  );
}
