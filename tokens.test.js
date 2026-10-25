import { describe, expect, test } from "bun:test";
import { cssText, tokenSheet, applyTokens } from "./tokens.js";

describe("tokens", () => {
  test("cssText is a non-empty string", () => {
    expect(typeof cssText).toBe("string");
    expect(cssText.length).toBeGreaterThan(0);
  });

  test("cssText contains light mode color tokens", () => {
    expect(cssText).toContain("--color-bg: #ffffff");
    expect(cssText).toContain("--color-surface: #f5f5f5");
    expect(cssText).toContain("--color-text: #1a1a1a");
    expect(cssText).toContain("--color-primary: #2563eb");
    expect(cssText).toContain("--color-accent: #7c3aed");
    expect(cssText).toContain("--color-success: #059669");
    expect(cssText).toContain("--color-warning: #d97706");
    expect(cssText).toContain("--color-error: #dc2626");
  });

  test("cssText contains dark mode media query", () => {
    expect(cssText).toContain("@media (prefers-color-scheme: dark)");
    expect(cssText).toContain("--color-bg: #0f172a");
    expect(cssText).toContain("--color-surface: #1e293b");
  });

  test("cssText contains spacing scale", () => {
    expect(cssText).toContain("--space-1: 0.25rem");
    expect(cssText).toContain("--space-4: 1rem");
    expect(cssText).toContain("--space-8: 2rem");
    expect(cssText).toContain("--space-16: 4rem");
  });

  test("cssText contains type scale", () => {
    expect(cssText).toContain("--font-xs: 0.75rem");
    expect(cssText).toContain("--font-base: 1rem");
    expect(cssText).toContain("--font-2xl: 1.5rem");
    expect(cssText).toContain("--font-mono: ui-monospace, monospace");
  });

  test("cssText contains transitions and radius", () => {
    expect(cssText).toContain("--transition-fast: 150ms ease");
    expect(cssText).toContain("--transition-base: 200ms ease");
    expect(cssText).toContain("--radius-sm: 0.25rem");
    expect(cssText).toContain("--radius-md: 0.375rem");
    expect(cssText).toContain("--radius-lg: 0.5rem");
  });

  test("cssText contains shadows", () => {
    expect(cssText).toContain("--shadow-sm:");
    expect(cssText).toContain("--shadow-md:");
  });

  test("tokenSheet is CSSStyleSheet or null", () => {
    const hasCSS = typeof CSSStyleSheet !== "undefined";
    if (hasCSS) {
      expect(tokenSheet).toBeInstanceOf(CSSStyleSheet);
    } else {
      expect(tokenSheet).toBeNull();
    }
  });

  test("tokenSheet has rules when CSSStyleSheet is available", () => {
    if (tokenSheet) {
      expect(tokenSheet.cssRules.length).toBeGreaterThan(0);
    }
  });

  test("cssText is inlined (not dynamically imported)", () => {
    // cssText should work without any bundler — it's a plain string constant
    expect(typeof cssText).toBe("string");
    expect(cssText).toContain(":root");
  });

  test("applyTokens is a function", () => {
    expect(typeof applyTokens).toBe("function");
  });

  test("applyTokens adds tokenSheet to shadowRoot adoptedStyleSheets", () => {
    if (!tokenSheet) return;
    const adopted = [];
    const shadowRoot = {
      get adoptedStyleSheets() { return adopted; },
      set adoptedStyleSheets(val) { adopted.length = 0; adopted.push(...val); },
    };
    applyTokens(shadowRoot);
    expect(adopted).toContain(tokenSheet);
  });

  test("applyTokens preserves existing adoptedStyleSheets", () => {
    if (!tokenSheet) return;
    const existing = new CSSStyleSheet();
    const adopted = [existing];
    const shadowRoot = {
      get adoptedStyleSheets() { return adopted; },
      set adoptedStyleSheets(val) { adopted.length = 0; adopted.push(...val); },
    };
    applyTokens(shadowRoot);
    expect(adopted).toContain(existing);
    expect(adopted).toContain(tokenSheet);
    expect(adopted.length).toBe(2);
  });

  test("applyTokens does not add duplicate sheets on repeated calls", () => {
    if (!tokenSheet) return;
    const adopted = [];
    const shadowRoot = {
      get adoptedStyleSheets() { return adopted; },
      set adoptedStyleSheets(val) { adopted.length = 0; adopted.push(...val); },
    };
    applyTokens(shadowRoot);
    applyTokens(shadowRoot);
    applyTokens(shadowRoot);
    expect(adopted.length).toBe(1);
    expect(adopted[0]).toBe(tokenSheet);
  });
});

describe("tokens (audit regressions)", () => {
  test("token rules also target :host, since :root matches nothing inside a shadow root", () => {
    expect(cssText).toMatch(/:root,\s*:host\s*\{/);
    const darkBlock = cssText.slice(cssText.indexOf("@media (prefers-color-scheme: dark)"));
    expect(darkBlock).toMatch(/:root,\s*:host\s*\{/);
  });

  test("tokens.js and tokens.css carry identical CSS", async () => {
    const file = await Bun.file(`${import.meta.dir}/tokens.css`).text();
    expect(cssText).toBe(file);
  });
});
