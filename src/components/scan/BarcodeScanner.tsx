"use client";

import { Camera, Keyboard, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";

/**
 * Camera barcode scanner.
 *
 * Uses the browser's native BarcodeDetector where it exists (Chrome and
 * Android, which is most of the warehouse floor) and lazily loads ZXing only
 * when it does not — notably iOS Safari. The fallback is a dynamic import so
 * the library never lands in the bundle for the devices that do not need it.
 *
 * Typing the number is always available and always first-class. Cameras fail:
 * a cracked lens, a torn label, a dark corner of the warehouse. A scanner that
 * makes manual entry feel like the error path is a scanner that stops work.
 */

type ScannerControls = { stop: () => void };

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => BarcodeDetectorLike;
  }
}

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"];

export function BarcodeScanner({
  onScan,
  onClose,
}: {
  onScan: (code: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<ScannerControls | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const doneRef = useRef(false);

  const [status, setStatus] = useState<"starting" | "scanning" | "unavailable">("starting");
  const [manual, setManual] = useState(false);

  const handle = useCallback(
    (code: string) => {
      // Guard against a detector firing twice on the same frame sequence.
      if (doneRef.current) return;
      doneRef.current = true;
      if (navigator.vibrate) navigator.vibrate(40);
      onScan(code);
    },
    [onScan],
  );

  useEffect(() => {
    if (manual) return;
    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // The rear camera, and a resolution high enough to resolve a barcode
          // from arm's length without pushing frames the decoder cannot keep up with.
          video: { facingMode: "environment", width: { ideal: 1280 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setStatus("scanning");

        if (typeof window !== "undefined" && window.BarcodeDetector) {
          const detector = new window.BarcodeDetector({ formats: FORMATS });
          const tick = async () => {
            if (cancelled || doneRef.current || !videoRef.current) return;
            try {
              const found = await detector.detect(videoRef.current);
              if (found.length > 0 && found[0].rawValue) {
                handle(found[0].rawValue);
                return;
              }
            } catch {
              // A single failed frame is normal; keep looking.
            }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          return;
        }

        // No native detector: pull in ZXing just for this device.
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled) return;
        const reader = new BrowserMultiFormatReader();
        controlsRef.current = await reader.decodeFromStream(
          stream,
          videoRef.current ?? undefined,
          (result) => {
            if (result) handle(result.getText());
          },
        );
      } catch {
        if (!cancelled) setStatus("unavailable");
      }
    }

    start();

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [manual, handle]);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-bitumen-950">
      <div className="flex items-center justify-between gap-3 px-5 pt-safe">
        <p className="py-4 font-display text-sm font-bold uppercase tracking-wide text-concrete-50">
          {manual ? "Type the number" : "Scan a barcode"}
        </p>
        <Button type="button" variant="quiet" onClick={onClose} aria-label="Close scanner">
          <X size={20} className="text-concrete-100" aria-hidden />
        </Button>
      </div>

      {manual || status === "unavailable" ? (
        <form
          className="flex-1 px-5"
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get("code");
            const code = String(value ?? "").trim();
            if (code) handle(code);
          }}
        >
          {status === "unavailable" && !manual ? (
            <p className="mb-4 border-2 border-warn bg-warn-soft px-3 py-2 text-sm text-warn">
              The camera is not available on this device. Type the number instead.
            </p>
          ) : null}

          <label htmlFor="code" className="micro mb-2 block text-concrete-400">
            Barcode
          </label>
          <input
            id="code"
            name="code"
            type="text"
            inputMode="numeric"
            autoFocus
            className="numeric w-full border-2 border-bitumen-700 bg-bitumen-900 px-3 py-3 text-concrete-50 outline-none focus-visible:border-focus"
          />
          <Button type="submit" className="mt-4 w-full">
            Look it up
          </Button>
        </form>
      ) : (
        <div className="relative flex-1 overflow-hidden">
          <video
            ref={videoRef}
            playsInline
            muted
            className="h-full w-full object-cover"
            aria-label="Camera viewfinder"
          />
          {/* A window to aim through, rather than a full-frame guess. */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-32 w-4/5 max-w-sm border-2 border-signal-500" />
          </div>
          <p className="absolute inset-x-0 bottom-6 text-center text-sm text-concrete-300">
            {status === "starting" ? "Starting the camera…" : "Hold the code inside the frame"}
          </p>
        </div>
      )}

      <div className="border-t-2 border-bitumen-700 px-5 py-4 pb-safe">
        <Button type="button" variant="secondary" onClick={() => setManual((value) => !value)}>
          {manual ? (
            <>
              <Camera size={15} aria-hidden />
              Use the camera
            </>
          ) : (
            <>
              <Keyboard size={15} aria-hidden />
              Type it instead
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
