// @ts-nocheck
import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en" style={{ height: "100%", overscrollBehaviorY: "auto" }}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        {/*
          Disable body scrolling on web to make ScrollView components work correctly.
          overscroll-behavior stays `auto` so mobile Chrome can still offer its
          native pull-to-refresh from the browser chrome (reload the page).
        */}
        <ScrollViewStyleReset />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              html, body { overscroll-behavior-y: auto; }
              body > div:first-child {
                position: fixed !important;
                top: 0; left: 0; right: 0; bottom: 0;
                overscroll-behavior-y: auto;
              }
              [role="tablist"] [role="tab"] * { overflow: visible !important; }
              [role="heading"], [role="heading"] * { overflow: visible !important; }
            `,
          }}
        />
      </head>
      <body
        style={{
          margin: 0,
          height: "100%",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          overscrollBehaviorY: "auto",
        }}
      >
        {children}
      </body>
    </html>
  );
}
