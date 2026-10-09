"use client";

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
        padding: 24,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        background: "#f7f8fa",
        color: "#1a1d24",
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

      <div style={{ maxWidth: 480, width: "100%", textAlign: "center" }}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>Talk to Aangan Studio</h1>
        <p style={{ fontSize: 14, color: "#5b6270", marginBottom: 24 }}>
          This connects to the same AI assistant that answers missed calls — speak into your
          microphone to try it. No price will ever be stated.
        </p>

        {!apiKey && (
          <p style={{ fontSize: 13, color: "#b91c1c" }}>
            NEXT_PUBLIC_VAANI_API_KEY is not set — the widget below won&apos;t load.
          </p>
        )}

        <div
          id="vaani-widget"
          style={{
            minHeight: 320,
            border: "1px solid #e2e5ea",
            borderRadius: 12,
            background: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#5b6270",
            fontSize: 13,
          }}
        >
          {loadError
            ? "Couldn't load the voice agent — check your connection and reload."
            : !scriptReady && "Loading voice agent…"}
        </div>
      </div>
    </div>
  );
}
