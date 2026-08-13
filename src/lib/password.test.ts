import { describe, expect, it } from "vitest";
import {
  describePasswordProblem,
  generateTemporaryPassword,
  MIN_PASSWORD_LENGTH,
} from "./password";

describe("describePasswordProblem", () => {
  it("accepts a long enough, matching password", () => {
    expect(describePasswordProblem("correct-horse", "correct-horse")).toBeNull();
  });

  it("asks for a password at all before anything else", () => {
    expect(describePasswordProblem("", "")).toBe("Choose a new password.");
  });

  it("holds the minimum length", () => {
    const short = "a".repeat(MIN_PASSWORD_LENGTH - 1);
    expect(describePasswordProblem(short, short)).toContain(String(MIN_PASSWORD_LENGTH));
    const exact = "a".repeat(MIN_PASSWORD_LENGTH);
    expect(describePasswordProblem(exact, exact)).toBeNull();
  });

  // Invisible in a password field, and the failure it causes looks like a
  // completely different problem at the next sign-in.
  it("catches leading and trailing spaces", () => {
    expect(describePasswordProblem(" longenough ", " longenough ")).toBe(
      "Remove the spaces at the start or end.",
    );
    expect(describePasswordProblem("long enough here", "long enough here")).toBeNull();
  });

  it("catches a mistyped confirmation", () => {
    expect(describePasswordProblem("correct-horse", "correct-hors")).toBe(
      "The two passwords do not match.",
    );
  });

  it("refuses the password they are already using", () => {
    expect(describePasswordProblem("correct-horse", "correct-horse", "correct-horse")).toBe(
      "Choose a password you have not used here before.",
    );
  });

  it("ignores the current password when there is not one", () => {
    expect(describePasswordProblem("correct-horse", "correct-horse", "")).toBeNull();
    expect(describePasswordProblem("correct-horse", "correct-horse", undefined)).toBeNull();
  });

  // Length is checked before matching, so someone typing a short password
  // twice is told the useful thing rather than being sent round again.
  it("reports the length problem before the match problem", () => {
    expect(describePasswordProblem("abc", "xyz")).toContain(String(MIN_PASSWORD_LENGTH));
  });
});

describe("generateTemporaryPassword", () => {
  it("is long enough to satisfy the rule it has to pass", () => {
    const password = generateTemporaryPassword();
    expect(password.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
    expect(describePasswordProblem(password, password)).toBeNull();
  });

  it("reads as three groups of four", () => {
    expect(generateTemporaryPassword()).toMatch(/^[^-]{4}-[^-]{4}-[^-]{4}$/);
  });

  // These get read out loud. A zero next to an O is a support call.
  it("never uses a character that can be misheard or misread", () => {
    const ambiguous = /[0O1lI]/;
    for (let i = 0; i < 500; i++) {
      expect(generateTemporaryPassword()).not.toMatch(ambiguous);
    }
  });

  it("does not repeat itself", () => {
    const seen = new Set(Array.from({ length: 200 }, generateTemporaryPassword));
    expect(seen.size).toBe(200);
  });

  // Rejection sampling should leave the alphabet flat. A modulo bias would
  // show up as the early characters appearing noticeably more often.
  it("draws from the alphabet without obvious bias", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i++) {
      for (const char of generateTemporaryPassword().replace(/-/g, "")) {
        counts.set(char, (counts.get(char) ?? 0) + 1);
      }
    }
    const tallies = [...counts.values()];
    const expected = 48000 / 55;
    expect(Math.min(...tallies)).toBeGreaterThan(expected * 0.6);
    expect(Math.max(...tallies)).toBeLessThan(expected * 1.4);
  });
});
