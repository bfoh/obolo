"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

/**
 * Mechanical counter for the headline valuation figure.
 *
 * Each digit is a strip of 0-9 that rolls into place, staggered left to right,
 * the way a physical counter settles. It is used once per screen, on the number
 * the whole app exists to report.
 *
 * The value is pre-formatted by the server (see lib/format) and passed in as a
 * string. Nothing is parsed or re-computed here -- this component animates
 * glyphs, it does not do arithmetic on money.
 */
export function Odometer({
  value,
  className,
  durationMs = 900,
}: {
  value: string;
  className?: string;
  durationMs?: number;
}) {
  const [rolled, setRolled] = useState(false);

  useEffect(() => {
    // Roll on the frame after paint, so the strips start at zero and move.
    const id = requestAnimationFrame(() => setRolled(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // The stagger counts digits only, so the delay does not jump across a comma
  // or a currency symbol. Computed up front rather than with a counter mutated
  // inside the map, which is not safe to reassign during render.
  let seen = 0;
  const characters = value.split("").map((char) => {
    const isDigit = char >= "0" && char <= "9";
    const digitIndex = isDigit ? seen++ : -1;
    return { char, isDigit, digitIndex };
  });

  return (
    // The rendered glyphs are decorative once the real value is announced.
    <span className={cn("inline-flex items-baseline leading-none", className)} aria-label={value}>
      {characters.map(({ char, isDigit, digitIndex }, index) => {
        if (!isDigit) {
          return (
            <span key={index} aria-hidden>
              {char}
            </span>
          );
        }

        const target = Number(char);

        return (
          <span key={index} className="inline-block h-[1em] overflow-hidden" aria-hidden>
            <span
              className="flex flex-col motion-reduce:transition-none"
              style={{
                transform: `translateY(-${rolled ? target : 0}em)`,
                transition: `transform ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1)`,
                transitionDelay: `${digitIndex * 45}ms`,
              }}
            >
              {DIGITS.map((digit) => (
                <span key={digit} className="block h-[1em]">
                  {digit}
                </span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
