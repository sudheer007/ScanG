// @ts-nocheck
import type { PropsWithChildren } from "react";

/**
 * Document scrolls on web (like a normal site / Cricbuzz).
 * Nested RN ScrollViews with overflow + a fixed root block Chrome's
 * address-bar pull-to-refresh — so we intentionally do NOT use
 * ScrollViewStyleReset or position:fixed on the root.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              html {
                background: #0A0A0C;
              }
              html, body {
                margin: 0;
                padding: 0;
                min-height: 100%;
                height: auto !important;
                overflow-x: hidden;
                overflow-y: auto !important;
                overscroll-behavior-y: auto;
                -webkit-overflow-scrolling: touch;
                background: #0A0A0C;
              }
              /* Unlock the Expo root so the document, not a fixed shell, scrolls */
              body > div:first-child {
                position: relative !important;
                inset: auto !important;
                top: auto !important;
                left: auto !important;
                right: auto !important;
                bottom: auto !important;
                min-height: 100dvh;
                height: auto !important;
                max-height: none !important;
                overflow: visible !important;
                overscroll-behavior-y: auto;
              }
              /* Let navigation/screen shells grow with content (document scroll) */
              body > div:first-child div {
                max-height: none;
              }
              /* Page scrollports rendered by AppScrollView.web */
              [data-page-scroll="true"] {
                overflow: visible !important;
                height: auto !important;
                max-height: none !important;
                flex: 0 0 auto !important;
              }
              /* Keep bottom tabs pinned to the viewport while the page scrolls */
              nav[role="navigation"],
              div[role="tablist"] {
                position: fixed !important;
                left: 0 !important;
                right: 0 !important;
                bottom: 0 !important;
                z-index: 100 !important;
              }
              [role="tablist"] [role="tab"] * { overflow: visible !important; }
              [role="heading"], [role="heading"] * { overflow: visible !important; }
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
