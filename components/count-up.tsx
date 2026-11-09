/**
 * CountUp — shows a number.
 *
 * It used to count up from 0 on load. In the hand-drawn style nothing moves
 * where people read numbers, so it now renders the value straight away. The
 * name and props stay so existing pages keep working.
 */

interface CountUpProps {
  value: number;
  /** Decimal places to keep (for percentages etc.). Defaults to 0. */
  decimals?: number;
  /** Ignored; kept for compatibility. */
  duration?: number;
}

export default function CountUp({ value, decimals = 0 }: CountUpProps) {
  return (
    <>
      {value.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
    </>
  );
}
