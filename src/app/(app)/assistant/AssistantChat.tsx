"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Mic, Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ProposalCard } from "./ProposalCard";
import { useSpeech } from "./useSpeech";

const SUGGESTIONS = [
  "How much rice is in the warehouse?",
  "What is running low?",
  "What is expiring soon?",
];

interface ProposalPart {
  proposal: true;
  tool: string;
  summary: string;
  input: Record<string, unknown>;
}

function isProposal(value: unknown): value is ProposalPart {
  return typeof value === "object" && value !== null && "proposal" in value;
}

export function AssistantChat({ name }: { name: string }) {
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/agent" }),
  });

  const speech = useSpeech((text) => {
    setInput(text);
    sendMessage({ text });
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const busy = status === "submitted" || status === "streaming";

  function submit(text: string) {
    const value = text.trim();
    if (!value || busy) return;
    sendMessage({ text: value });
    setInput("");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-5 py-6">
        {messages.length === 0 ? (
          <div className="mx-auto max-w-md text-center">
            <Sparkles size={26} className="mx-auto text-ink-3" aria-hidden />
            <h2 className="mt-4 font-display text-lg font-bold text-ink">Ask me about the stock</h2>
            <p className="mt-2 text-sm text-ink-3">
              I can look things up straight away. Anything that changes the books I will describe
              first and ask you to confirm — I cannot record it myself.
            </p>
            <div className="mt-6 flex flex-col gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <Button
                  key={suggestion}
                  type="button"
                  variant="secondary"
                  onClick={() => submit(suggestion)}
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <ul className="mx-auto flex max-w-2xl flex-col gap-4">
            {messages.map((message) => (
              <li
                key={message.id}
                className={message.role === "user" ? "flex justify-end" : "flex justify-start"}
              >
                <div
                  className={
                    message.role === "user"
                      ? "max-w-[85%] border-2 border-line bg-ink px-4 py-2.5 text-sm text-ink-invert"
                      : "w-full max-w-[95%]"
                  }
                >
                  {message.parts.map((part, index) => {
                    if (part.type === "text") {
                      return (
                        <p
                          key={index}
                          className={
                            message.role === "user"
                              ? "whitespace-pre-wrap"
                              : "rule bg-panel px-4 py-2.5 text-sm whitespace-pre-wrap text-ink"
                          }
                        >
                          {part.text}
                        </p>
                      );
                    }

                    // A write tool returns a proposal rather than doing anything.
                    // It is rendered as something to accept, never as a result.
                    if (part.type.startsWith("tool-") && "output" in part && isProposal(part.output)) {
                      return (
                        <ProposalCard
                          key={index}
                          tool={part.output.tool}
                          summary={part.output.summary}
                          input={part.output.input}
                        />
                      );
                    }

                    return null;
                  })}
                </div>
              </li>
            ))}
            {busy ? (
              <li className="text-sm text-ink-3" aria-live="polite">
                Thinking…
              </li>
            ) : null}
            <div ref={endRef} />
          </ul>
        )}

        {error ? (
          <p role="alert" className="mx-auto mt-4 max-w-2xl border-2 border-signal bg-signal-soft px-3 py-2 text-sm text-signal">
            {error.message.includes("budget")
              ? error.message
              : "The assistant could not answer. Try again."}
          </p>
        ) : null}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(input);
        }}
        className="border-t-2 border-line bg-surface px-5 py-4 pb-safe"
      >
        <div className="mx-auto flex max-w-2xl gap-2">
          {speech.supported ? (
            <Button
              type="button"
              variant={speech.listening ? "danger" : "secondary"}
              onClick={speech.toggle}
              aria-label={speech.listening ? "Stop listening" : "Speak instead of typing"}
            >
              <Mic size={16} aria-hidden />
            </Button>
          ) : null}

          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={speech.listening ? "Listening…" : `Ask something, ${name}`}
            aria-label="Message"
            className="min-w-0 flex-1 border-2 border-line bg-panel-2 px-3 py-2.5 text-ink outline-none focus-visible:border-focus"
          />

          <Button type="submit" disabled={busy || !input.trim()} aria-label="Send">
            <Send size={16} aria-hidden />
          </Button>
        </div>
      </form>
    </div>
  );
}
