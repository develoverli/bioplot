/**
 * The mark: a rising bar chart whose tallest bar is a chain, sprouting.
 *
 * Three ideas in one shape, in the order the tool works in — it compares (the bars), it reads
 * from a chain (the links), and what it is comparing is a farm (the sprout). The tile is filled
 * rather than transparent so the mark survives a light tab strip and a dark one unchanged.
 *
 * Kept in step with `scripts/make-icons.py`, which draws the same geometry for the extension.
 */
export function Logo({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Bioplot"
      className={className}
    >
      <rect width="64" height="64" rx="15" fill="#1e8a4e" />

      {/* Left to right, each bar taller than the last. */}
      <rect x="12.5" y="37.1" width="9.6" height="14.1" rx="2" fill="#86efac" />
      <rect x="25.6" y="28.2" width="9.6" height="23" rx="2" fill="#bef6d6" />
      <rect x="38.7" y="19.2" width="9.6" height="32" rx="2" fill="#f5fdf9" />

      {/* The chain, cut into the tallest bar so it reads as texture, not clutter. */}
      <g fill="none" stroke="#10542f" strokeWidth="1.9">
        <circle cx="43.5" cy="29" r="2.7" />
        <circle cx="43.5" cy="38.5" r="2.7" />
      </g>

      {/* The ground line is what makes three sticks a chart. */}
      <rect x="10.9" y="51.2" width="41" height="3.2" rx="1.6" fill="#10542f" />

      {/* The sprout grows out of the bar, not beside it. */}
      <rect x="42.5" y="12" width="2.1" height="8.5" rx="1" fill="#6ee29c" />
      <ellipse cx="49" cy="13.4" rx="6.5" ry="3.5" fill="#86efac" transform="rotate(-32 49 13.4)" />
      <ellipse cx="38" cy="13.4" rx="6.5" ry="3.5" fill="#5fd68d" transform="rotate(32 38 13.4)" />
    </svg>
  )
}
