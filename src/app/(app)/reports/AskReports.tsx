"use client";

import { Search } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormError } from "@/components/ui/FormError";
import { money } from "@/lib/format";

const EXAMPLES = [
  "Which products made the most money last month?",
  "What stock has not moved in two months?",
  "How much have we lost to damage this quarter?",
  "What should I reorder?",
];

interface Answer {
  answer: string;
  report: string;
  why: string;
  rows: Record<string, unknown>[];
}

/** Values arrive as text so they stay exact; format the money-shaped ones. */
function present(key: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  const looksLikeMoney = /value|cost|margin|revenue|tied_up|lost/.test(key);
  if (looksLikeMoney && !Number.isNaN(Number(value))) return money(String(value));
  return String(value);
}

export function AskReports() {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Answer | null>(null);

  async function ask(text: string) {
    const value = text.trim();
    if (!value || busy) return;

    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/report-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: value }),
      });
      const data = await response.json();
      if (!response.ok) setError(data.error ?? "Could not answer that.");
      else setResult(data as Answer);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const columns = result?.rows?.[0] ? Object.keys(result.rows[0]) : [];

  return (
    <div className="max-w-3xl">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          ask(question);
        }}
      >
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
              aria-hidden
            />
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask about margin, dead stock, shrinkage, what to reorder"
              aria-label="Question"
              className="w-full border-2 border-line bg-panel-2 py-2.5 pl-9 pr-3 text-ink outline-none focus-visible:border-focus"
            />
          </div>
          <Button type="submit" disabled={busy || !question.trim()}>
            {busy ? "Working…" : "Ask"}
          </Button>
        </div>
      </form>

      {!result && !busy ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <Button
              key={example}
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setQuestion(example);
                ask(example);
              }}
            >
              {example}
            </Button>
          ))}
        </div>
      ) : null}

      <FormError message={error} />

      {result ? (
        <>
          <section className="rule mt-5 bg-panel p-5">
            <p className="micro">{result.report.replace(/_/g, " ")}</p>
            <p className="mt-2 text-ink">{result.answer}</p>
          </section>

          {result.rows.length > 0 ? (
            <div className="rule mt-4 overflow-x-auto bg-panel">
              <table className="w-full min-w-[32rem] border-collapse text-left">
                <thead>
                  <tr className="border-b-2 border-line bg-panel-sunk">
                    {columns.map((column) => (
                      <th key={column} scope="col" className="micro px-4 py-2.5">
                        {column.replace(/_/g, " ")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, index) => (
                    <tr key={index} className="border-b border-hairline last:border-b-0">
                      {columns.map((column) => (
                        <td key={column} className="numeric px-4 py-2.5 text-sm text-ink">
                          {present(column, row[column])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-4 text-sm text-ink-3">That report came back empty.</p>
          )}
        </>
      ) : null}
    </div>
  );
}
