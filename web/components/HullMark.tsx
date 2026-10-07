/**
 * The fleet's number, IX, as it would be painted on a hull: white block
 * numerals with a hard shadow. Decorative, so it is hidden from screen readers.
 */
export function HullMark({ className }: { className?: string }) {
  const numerals = (
    <>
      <path d="M0 0h170v70h-40v260h40v70H0v-70h40V70H0z" />
      <path d="M210 0h92l218 400h-92z" />
      <path d="M428 0h92L302 400h-92z" />
    </>
  );
  return (
    <svg className={className} viewBox="0 0 540 420" aria-hidden="true" focusable="false">
      <g transform="translate(16 16)" fill="var(--ink)" opacity="0.3">
        {numerals}
      </g>
      <g fill="var(--paint)">{numerals}</g>
    </svg>
  );
}
