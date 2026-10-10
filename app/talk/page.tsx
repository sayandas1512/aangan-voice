"use client";

import Link from "next/link";
import Script from "next/script";
import { useState } from "react";

declare global {
  interface Window {
    VaaniVoice?: {
      textvoice: (opts: { apiKey: string; container: string; flowId?: string }) => void;
    };
  }
}

/**
 * Live demo page for the voice agent, using Vaani's drop-in embed widget
 * (vaanilabs.in/docs/api/embed) instead of a phone call — the brief's
 * original telephony design (Twilio number, forward-on-no-answer) is
 * replaced by a WebRTC-in-browser session per DECISIONS.md. The widget
 * handles mic capture, the WebSocket session, and audio playback itself;
 * this page just mounts it into a container once the embed script loads.
 *
 * The call-ended webhook (app/api/vaani/webhook/call-ended) fires exactly
 * the same way regardless of whether the call came in by phone or through
 * this page — nothing downstream changes.
 */
export default function TalkPage() {
  const [scriptReady, setScriptReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const apiKey = process.env.NEXT_PUBLIC_VAANI_API_KEY;
  const flowId = process.env.NEXT_PUBLIC_VAANI_FLOW_ID;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px",
        fontFamily: "var(--font-geist-sans), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        background: "#f6f4f0",
        color: "#1d1b18",
        colorScheme: "light",
      }}
    >
      <Script
        src="https://www.vaanilabs.in/embed/v1/vaanivoice.js"
        strategy="afterInteractive"
        onLoad={() => {
          if (!apiKey) return;
          if (!window.VaaniVoice) {
            setLoadError(true);
            return;
          }
          window.VaaniVoice.textvoice({ apiKey, container: "#vaani-widget", flowId });
          setScriptReady(true);
        }}
        onError={() => setLoadError(true)}
      />

      <div style={{ maxWidth: 520, width: "100%", textAlign: "center" }}>
        <Link
          href="/"
          style={{ display: "inline-flex", alignItems: "center", gap: 10, fontWeight: 650, marginBottom: 28 }}
        >
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: 9,
              background: "#9c4a2f",
              color: "#fff",
              display: "grid",
              placeItems: "center",
              fontWeight: 700,
            }}
          >
            A
          </span>
          Aangan Studio
        </Link>

        <h1 style={{ fontSize: 30, letterSpacing: "-0.03em", lineHeight: 1.15, marginBottom: 10 }}>
          Talk to the assistant
        </h1>
        <p style={{ fontSize: 15, lineHeight: 1.55, color: "#6b655c", marginBottom: 22 }}>
          This is the same assistant that answers the studio&apos;s calls. Allow your microphone and say hello — it will
          ask a few questions and offer to book a consultation. It never quotes a price.
        </p>

        {!apiKey && (
          <p style={{ fontSize: 13, color: "#b3261e", marginBottom: 14 }}>
            NEXT_PUBLIC_VAANI_API_KEY is not set — the widget below won&apos;t load.
          </p>
        )}

        <div
          id="vaani-widget"
          style={{
            minHeight: 320,
            border: "1px solid #e8e3da",
            borderRadius: 16,
            background: "#ffffff",
            boxShadow: "0 1px 2px rgba(29,27,24,0.04)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#6b655c",
            fontSize: 14,
          }}
        >
          {loadError
            ? "Couldn't load the voice agent — check your connection and reload."
            : !scriptReady && "Loading voice agent…"}
        </div>

        <p
          style={{
            marginTop: 18,
            padding: "12px 16px",
            borderRadius: 12,
            background: "#f6e9e2",
            color: "#5c2b1a",
            fontSize: 13.5,
            lineHeight: 1.5,
            textAlign: "left",
          }}
        >
          <strong>Try saying:</strong> &ldquo;I&apos;d like to redo my 2BHK in Baner — full interiors, about 1,000 sq ft,
          starting in a couple of months.&rdquo;
        </p>

        <p style={{ marginTop: 22, fontSize: 13.5 }}>
          <Link href="/dashboard" style={{ color: "#7d3a24", fontWeight: 600 }}>
            After the call, see what the assistant captured →
          </Link>
        </p>
      </div>
    </div>
  );
}
