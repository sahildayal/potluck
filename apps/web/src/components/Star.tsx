/**
 * The favourite marker.
 *
 * The requirement asks specifically for a star, and saffron is reserved in this
 * palette for exactly two things — this and a running timer — so a filled star
 * carries weight instead of blending into general decoration.
 */
export function Star({
  filled = false,
  className = '',
}: {
  filled?: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.8}
      strokeLinejoin="round"
    >
      <path d="M12 2.6l2.9 5.9 6.5.95-4.7 4.58 1.1 6.47L12 17.44l-5.8 3.06 1.1-6.47-4.7-4.58 6.5-.95z" />
    </svg>
  );
}
