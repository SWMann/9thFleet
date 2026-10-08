import Link from "next/link";
import { Icon } from "@/components/Icon";

/** The two ways into the fleet manual: volume by volume, or by the post you hold. */
export function ManualBar({ current }: { current: "volume" | "role" }) {
  return (
    <nav className="subbar" aria-label="Fleet manual">
      <div className="wrap subbar-row">
        <Link href="/manual" aria-current={current === "volume" ? "true" : undefined}>
          <Icon name="book" size={18} />
          By volume
        </Link>
        <Link href="/roles" aria-current={current === "role" ? "true" : undefined}>
          <Icon name="person" size={18} />
          By role
        </Link>
      </div>
    </nav>
  );
}
