"use client";

import { Component, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import type { PlainField, RichEditorProps } from "./RichEditor";

/** The editor once it has arrived, with what the plain field held and how it was labelled at that moment. */
type Arrived = { Editor: ComponentType<RichEditorProps>; initial: string; label: { id: string; text: string } | null };

/** If the editor fails while it is being drawn, the page carries on with the plain field. */
class Guard extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFail();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * A long text field with formatting.
 *
 * It starts as the plain field it has always been, which works with no
 * scripts at all and holds the text as Markdown. Once the editor has arrived
 * it takes the field's place. The plain field stays in the form, out of sight,
 * and is kept in step, so the form sends the same thing either way. If the
 * editor cannot be fetched, fails, or cannot hold the field's words as they
 * are, the plain field carries on and nothing is lost.
 *
 * `line` is for a short piece that sits in a line of the page, such as a
 * role's summary: bold, italic and links, and nothing that makes a block.
 */
export function RichField({
  id,
  name,
  defaultValue = "",
  rows = 4,
  maxLength,
  required = false,
  line = false,
  describedBy,
}: {
  id: string;
  name: string;
  defaultValue?: string;
  rows?: number;
  maxLength?: number;
  required?: boolean;
  line?: boolean;
  describedBy?: string;
}) {
  const source = useRef<HTMLTextAreaElement>(null);
  const [arrived, setArrived] = useState<Arrived | null>(null);

  useEffect(() => {
    let wanted = true;
    import("./RichEditor").then(
      (loaded) => {
        if (!wanted) return;
        // The field's label is given an id, so the editor can be named by it.
        const label = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(id)}"]`);
        if (label && !label.id) label.id = `${id}-label`;
        setArrived({
          Editor: loaded.RichEditor,
          // Whatever has been typed into the plain field while the editor was on its way is kept.
          initial: source.current?.value ?? defaultValue,
          label: label ? { id: label.id, text: label.textContent?.trim() ?? "" } : null,
        });
      },
      // If the editor cannot be fetched, the plain field carries on.
      () => {},
    );
    return () => {
      wanted = false;
    };
    // The editor is fetched once. What the field held at first is read then, not kept up with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  // An editor that failed is not tried again on this field.
  const [failed, setFailed] = useState(false);
  const fail = useCallback(() => setFailed(true), []);
  const Editor = failed ? null : (arrived?.Editor ?? null);
  const plain = useMemo(
    (): PlainField => ({
      read: () => source.current?.value ?? "",
      write: (markdown) => {
        if (source.current) source.current.value = markdown;
      },
      form: () => source.current?.form ?? null,
    }),
    [],
  );

  return (
    <div className={line ? "rich-field rich-field-line" : "rich-field"}>
      <textarea
        ref={source}
        id={Editor ? undefined : id}
        name={name}
        rows={rows}
        maxLength={Editor ? undefined : maxLength}
        required={Editor ? undefined : required}
        defaultValue={defaultValue}
        aria-describedby={Editor ? undefined : describedBy}
        hidden={Editor !== null}
      />
      {arrived && Editor ? (
        <Guard onFail={fail}>
          <Editor
            fieldId={id}
            plain={plain}
            initial={arrived.initial}
            label={arrived.label}
            rows={rows}
            maxLength={maxLength}
            required={required}
            line={line}
            describedBy={describedBy}
            onFail={fail}
          />
        </Guard>
      ) : null}
    </div>
  );
}
