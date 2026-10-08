import { menu } from "@/lib/menu";
import { MenuLinks } from "./MenuLinks";
import { Picture } from "./Picture";

/** The menu's columns: one group of pages each, over a picture. */
export function MenuPanel() {
  return (
    <div className="menu-columns">
      {menu.map((group) => (
        <div className="menu-column" key={group.title}>
          <Picture name={group.picture} sizes="(max-width: 760px) 100vw, 34vw" credit="bottom-left" />
          <div className="menu-shade" aria-hidden="true" />
          <h2>{group.title}</h2>
          <MenuLinks group={group} />
        </div>
      ))}
    </div>
  );
}
