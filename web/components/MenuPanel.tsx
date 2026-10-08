import { menu } from "@/lib/menu";
import { MenuLinks } from "./MenuLinks";
import { Picture } from "./Picture";

/** The menu's columns: one group of pages each, over a picture. */
export function MenuPanel() {
  return (
    <div className="menu-columns">
      {menu.map((group) => (
        <div className="menu-column" key={group.title}>
          {/* A column is tall and narrow, so its picture is drawn far wider than the column: about 16/9 of the screen's height. */}
          <Picture name={group.picture} sizes="(max-width: 760px) 100vw, 178vh" credit="bottom-left" />
          <div className="menu-shade" aria-hidden="true" />
          <h2>{group.title}</h2>
          <MenuLinks group={group} />
        </div>
      ))}
    </div>
  );
}
