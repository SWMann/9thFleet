"use client";

import { ReactRenderer } from "@tiptap/react";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Icon, type IconName } from "@/components/Icon";

/**
 * The list that opens under the cursor when @ or / is typed. It is moved
 * through with the arrow keys and chosen with Enter or Tab, while the cursor
 * stays in the text. A click chooses too.
 */

export type MenuItem = { key: string; label: string; note?: string; icon?: IconName; group?: string };

type Handle = { onKeyDown: (event: KeyboardEvent) => boolean };

type ListProps<Item extends MenuItem> = {
  items: Item[];
  choose: (item: Item) => void;
  label: string;
  empty: string;
  /** The list's id. Each choice's own is made from it. */
  id: string;
  /** The editor the list belongs to, which is told which choice is picked, since the cursor stays in it. */
  anchor: HTMLElement;
  ref?: Ref<Handle>;
};

let lists = 0;

function MenuList<Item extends MenuItem>({ items, choose, label, empty, id, anchor, ref }: ListProps<Item>) {
  const [picked, setPicked] = useState({ at: 0, among: items });
  // A new list starts from its top.
  const at = picked.among === items ? Math.min(picked.at, Math.max(0, items.length - 1)) : 0;
  const list = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    onKeyDown(event) {
      if (items.length === 0) return false;
      if (event.key === "ArrowDown") {
        setPicked({ at: (at + 1) % items.length, among: items });
        return true;
      }
      if (event.key === "ArrowUp") {
        setPicked({ at: (at + items.length - 1) % items.length, among: items });
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        choose(items[at]);
        return true;
      }
      return false;
    },
  }));

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    // A screen reader follows the pick from the editor, where the cursor is.
    if (items.length > 0) anchor.setAttribute("aria-activedescendant", `${id}-${at}`);
    else anchor.removeAttribute("aria-activedescendant");
  }, [at, items, anchor, id]);

  return (
    <div className="rich-menu" role="listbox" id={id} aria-label={label} ref={list}>
      {items.length === 0 ? <p className="rich-menu-empty">{empty}</p> : null}
      {items.map((item, index) => (
        <div key={item.key} role="presentation">
          {item.group && item.group !== items[index - 1]?.group ? <p className="rich-menu-group">{item.group}</p> : null}
          <button
            type="button"
            role="option"
            id={`${id}-${index}`}
            aria-selected={index === at}
            // The cursor stays in the text, so that what is chosen goes where it was.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(item)}
            // Only a mouse that moves chooses, so a list that opens under a still pointer starts from its top.
            onMouseMove={() => (index === at ? undefined : setPicked({ at: index, among: items }))}
          >
            {item.icon ? <Icon name={item.icon} size={16} /> : null}
            <span>
              {item.label}
              {item.note ? <small>{item.note}</small> : null}
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}

/** How a list of choices is drawn for the editor: opened under the cursor, kept up to date, and closed again. */
export function menuOf<Item extends MenuItem>(label: string, empty: string) {
  return () => {
    let drawn: ReactRenderer<Handle, ListProps<Item>> | null = null;
    let unmount: (() => void) | null = null;
    let anchor: HTMLElement | null = null;
    lists += 1;
    const id = `rich-menu-${lists}`;
    const propsFor = (props: SuggestionProps<Item, Item>): ListProps<Item> => ({
      items: props.items,
      choose: (item) => props.command(item),
      label,
      empty,
      id,
      anchor: props.editor.view.dom,
    });
    return {
      onStart(props: SuggestionProps<Item, Item>) {
        anchor = props.editor.view.dom;
        anchor.setAttribute("aria-haspopup", "listbox");
        anchor.setAttribute("aria-expanded", "true");
        anchor.setAttribute("aria-controls", id);
        drawn = new ReactRenderer(MenuList<Item>, { props: propsFor(props), editor: props.editor });
        unmount = props.mount(drawn.element as HTMLElement);
      },
      onUpdate(props: SuggestionProps<Item, Item>) {
        drawn?.updateProps(propsFor(props));
      },
      onKeyDown({ event }: SuggestionKeyDownProps) {
        return drawn?.ref?.onKeyDown(event) ?? false;
      },
      onExit() {
        for (const name of ["aria-haspopup", "aria-expanded", "aria-controls", "aria-activedescendant"]) anchor?.removeAttribute(name);
        anchor = null;
        unmount?.();
        drawn?.destroy();
        drawn = null;
        unmount = null;
      },
    };
  };
}
