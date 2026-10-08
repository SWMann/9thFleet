import type { CSSProperties, ReactNode } from "react";
import type { Count, Series } from "@/lib/admin";

/**
 * The charts of the admin pages, drawn in plain HTML.
 *
 * Every bar of one chart is one colour, because it is one series. The only
 * chart with more than one colour is the funnel, whose steps are in order and
 * so run from light to dark in one hue. Each value is written beside its bar,
 * in the page's own text colour, so nothing is told by colour alone. Green,
 * amber and red are kept for states, and are never a chart colour.
 */

const share = (value: number, of: number): CSSProperties => ({ "--share": of > 0 ? Math.min(1, value / of) : 0 }) as CSSProperties;

/** A row of headline figures. */
export function Stats({ items }: { items: { label: string; value: ReactNode; note?: ReactNode }[] }) {
  // Up to five sit in one row. More than that break into even rows, so no figure is left on its own.
  const perRow = items.length <= 5 ? items.length : items.length % 3 === 0 ? 3 : 4;
  return (
    <dl className="kpis" style={{ "--per-row": perRow } as CSSProperties}>
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>
            {item.value}
            {item.note ? <small> {item.note}</small> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** One chart or table, with its title. */
export function Panel({ title, note, wide = false, children }: { title: string; note?: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <section className={wide ? "chart chart-wide" : "chart"}>
      <h3>{title}</h3>
      {children}
      {note ? <p className="chart-note">{note}</p> : null}
    </section>
  );
}

/**
 * Bars across the page, one to a row, each with its value at its tip. It is a
 * table, so it reads as one without the bars.
 */
export function Bars({
  caption,
  head,
  rows,
  ordered = false,
  empty = "Nothing to count yet.",
}: {
  caption: string;
  /** The names of the two columns, for a screen reader. */
  head: [string, string];
  rows: Count[];
  /** The rows are steps in order, so they run from light to dark. */
  ordered?: boolean;
  empty?: string;
}) {
  const most = Math.max(0, ...rows.map((row) => row.value));
  if (most === 0) return <p className="chart-empty">{empty}</p>;
  return (
    <table className={ordered ? "bars bars-ordered" : "bars"}>
      <caption className="visually-hidden">{caption}</caption>
      <thead className="visually-hidden">
        <tr>
          <th scope="col">{head[0]}</th>
          <th scope="col">{head[1]}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th scope="row">{row.label}</th>
            <td>
              <div className="bars-line">
                <span className="bars-bar" style={share(row.value, most)} data-none={row.value === 0 ? "" : undefined} aria-hidden="true" />
                <span className="bars-value">{row.value}</span>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** How much of each thing is done, as a filled track: posts filled of posts open. */
export function Ratios({
  caption,
  head,
  rows,
  empty = "Nothing to count yet.",
}: {
  caption: string;
  head: [string, string];
  rows: { label: string; value: number; of: number; note?: string }[];
  empty?: string;
}) {
  if (rows.length === 0) return <p className="chart-empty">{empty}</p>;
  return (
    <table className="bars bars-ratio">
      <caption className="visually-hidden">{caption}</caption>
      <thead className="visually-hidden">
        <tr>
          <th scope="col">{head[0]}</th>
          <th scope="col">{head[1]}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th scope="row">
              {row.label}
              {row.note ? <small>{row.note}</small> : null}
            </th>
            <td>
              <div className="bars-line">
                <span className="bars-track" aria-hidden="true">
                  <span style={share(row.value, row.of)} />
                </span>
                <span className="bars-value">
                  {row.value} of {row.of}
                </span>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Columns over time, oldest on the left, each with its value on top. */
export function Columns({
  caption,
  series,
  noun,
  empty = "Nothing to count yet.",
}: {
  caption: string;
  series: Series;
  /** What one of the things counted is called: "application", "event". */
  noun: [string, string];
  empty?: string;
}) {
  const most = Math.max(0, ...series.map((point) => point.value));
  if (most === 0) return <p className="chart-empty">{empty}</p>;
  return (
    <ol className="colchart" aria-label={caption}>
      {series.map((point) => (
        <li key={point.long} title={`${point.long}: ${point.value}`}>
          <span className="colchart-plot" aria-hidden="true">
            <span className="colchart-value">{point.value > 0 ? point.value : ""}</span>
            <span className="colchart-bar" style={share(point.value, most)} />
          </span>
          <span className="colchart-label" aria-hidden="true">
            {point.label}
          </span>
          <span className="visually-hidden">
            {point.long}: {point.value} {point.value === 1 ? noun[0] : noun[1]}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** One number against the number it is heading for. */
export function Meter({ label, value, max, ends }: { label: string; value: number; max: number; ends: [string, string] }) {
  return (
    <div className="meter-block">
      <div
        className="meter"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.min(value, max)}
        aria-valuetext={`${value} of ${max}`}
      >
        <span style={share(value, max)} />
      </div>
      <p className="meter-ends" aria-hidden="true">
        <span>{ends[0]}</span>
        <span>{ends[1]}</span>
      </p>
    </div>
  );
}

export const percent = (value: number | null) => (value === null ? "None yet" : `${Math.round(value * 100)}%`);

/** A table that may be wider than a phone. It scrolls sideways, and the keyboard can reach it. */
export function Scroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="table-scroll" tabIndex={0} role="group" aria-label={label}>
      {children}
    </div>
  );
}
