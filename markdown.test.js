import { describe, expect, test, beforeEach } from "bun:test";
import { Window } from "happy-dom";
import { MarkdownRenderer } from "./markdown.js";

function createRenderer() {
  const win = new Window();
  const container = win.document.createElement("div");
  const md = new MarkdownRenderer(container);
  return { md, container, win };
}

describe("MarkdownRenderer", () => {
  test("headings h1-h6", () => {
    const { md, container } = createRenderer();
    md.render("# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6");
    const h1 = container.querySelector("h1");
    const h2 = container.querySelector("h2");
    const h3 = container.querySelector("h3");
    const h4 = container.querySelector("h4");
    const h5 = container.querySelector("h5");
    const h6 = container.querySelector("h6");
    expect(h1).toBeTruthy();
    expect(h1.textContent).toBe("H1");
    expect(h2.textContent).toBe("H2");
    expect(h3.textContent).toBe("H3");
    expect(h4.textContent).toBe("H4");
    expect(h5.textContent).toBe("H5");
    expect(h6.textContent).toBe("H6");
  });

  test("bold text", () => {
    const { md, container } = createRenderer();
    md.render("This is **bold** text");
    const strong = container.querySelector("strong");
    expect(strong).toBeTruthy();
    expect(strong.textContent).toBe("bold");
    expect(container.textContent).toBe("This is bold text");
  });

  test("italic text", () => {
    const { md, container } = createRenderer();
    md.render("This is *italic* text");
    const em = container.querySelector("em");
    expect(em).toBeTruthy();
    expect(em.textContent).toBe("italic");
    expect(container.textContent).toBe("This is italic text");
  });

  test("bold and italic combined", () => {
    const { md, container } = createRenderer();
    md.render("This is ***bold italic*** text");
    const strong = container.querySelector("strong");
    const em = container.querySelector("em");
    expect(strong).toBeTruthy();
    expect(em).toBeTruthy();
    expect(strong.textContent).toBe("bold italic");
    expect(container.textContent).toBe("This is bold italic text");
  });

  test("inline code", () => {
    const { md, container } = createRenderer();
    md.render("Use `code` here");
    const code = container.querySelector("code");
    expect(code).toBeTruthy();
    expect(code.textContent).toBe("code");
    expect(container.textContent).toBe("Use code here");
  });

  test("fenced code block", () => {
    const { md, container } = createRenderer();
    md.render("```js\nconst x = 1;\n```");
    const pre = container.querySelector("pre");
    const code = container.querySelector("code");
    expect(pre).toBeTruthy();
    expect(code).toBeTruthy();
    expect(code.textContent).toBe("const x = 1;");
    expect(code.className).toBe("language-js");
  });

  test("unordered list", () => {
    const { md, container } = createRenderer();
    md.render("- item 1\n- item 2\n- item 3");
    const ul = container.querySelector("ul");
    expect(ul).toBeTruthy();
    const items = ul.querySelectorAll("li");
    expect(items.length).toBe(3);
    expect(items[0].textContent).toBe("item 1");
    expect(items[1].textContent).toBe("item 2");
    expect(items[2].textContent).toBe("item 3");
  });

  test("ordered list", () => {
    const { md, container } = createRenderer();
    md.render("1. first\n2. second\n3. third");
    const ol = container.querySelector("ol");
    expect(ol).toBeTruthy();
    const items = ol.querySelectorAll("li");
    expect(items.length).toBe(3);
    expect(items[0].textContent).toBe("first");
    expect(items[1].textContent).toBe("second");
    expect(items[2].textContent).toBe("third");
  });

  test("valid http/https links", () => {
    const { md, container } = createRenderer();
    md.render("[click here](https://example.com)");
    const a = container.querySelector("a");
    expect(a).toBeTruthy();
    expect(a.textContent).toBe("click here");
    expect(a.getAttribute("href")).toBe("https://example.com");
  });

  test("http links also work", () => {
    const { md, container } = createRenderer();
    md.render("[http link](http://example.com)");
    const a = container.querySelector("a");
    expect(a).toBeTruthy();
    expect(a.getAttribute("href")).toBe("http://example.com");
  });

  test("javascript: links are stripped", () => {
    const { md, container } = createRenderer();
    md.render("[click](javascript:alert(1))");
    const a = container.querySelector("a");
    // Should not create a link, or the href should be stripped
    if (a) {
      expect(a.getAttribute("href")).not.toContain("javascript:");
    }
    // Text should still be present
    expect(container.textContent).toContain("click");
  });

  test("tables", () => {
    const { md, container } = createRenderer();
    md.render("| Header 1 | Header 2 |\n|----------|----------|\n| cell 1   | cell 2   |\n| cell 3   | cell 4   |");
    const table = container.querySelector("table");
    expect(table).toBeTruthy();
    const thead = table.querySelector("thead");
    const tbody = table.querySelector("tbody");
    expect(thead).toBeTruthy();
    expect(tbody).toBeTruthy();
    const ths = thead.querySelectorAll("th");
    expect(ths.length).toBe(2);
    expect(ths[0].textContent).toBe("Header 1");
    expect(ths[1].textContent).toBe("Header 2");
    const rows = tbody.querySelectorAll("tr");
    expect(rows.length).toBe(2);
    const tds1 = rows[0].querySelectorAll("td");
    expect(tds1[0].textContent).toBe("cell 1");
    expect(tds1[1].textContent).toBe("cell 2");
    const tds2 = rows[1].querySelectorAll("td");
    expect(tds2[0].textContent).toBe("cell 3");
    expect(tds2[1].textContent).toBe("cell 4");
  });

  test("streaming: append chunks, verify stable nodes", () => {
    const { md, container } = createRenderer();
    md.append("# Hello\n");
    const h1 = container.querySelector("h1");
    expect(h1.textContent).toBe("Hello");
    md.append("World");
    // The h1 should still be the same node
    const h1After = container.querySelector("h1");
    expect(h1After).toBe(h1);
    expect(h1After.textContent).toBe("Hello");
  });

  test("streaming: multiple appends build up content", () => {
    const { md, container } = createRenderer();
    md.append("# Title\n");
    md.append("Some text\n");
    md.append("- item\n");
    const h1 = container.querySelector("h1");
    const p = container.querySelector("p");
    const li = container.querySelector("li");
    expect(h1.textContent).toBe("Title");
    expect(p.textContent).toBe("Some text");
    expect(li.textContent).toBe("item");
  });

  test("empty/blank input", () => {
    const { md, container } = createRenderer();
    md.render("");
    expect(container.childNodes.length).toBe(0);
  });

  test("blank lines only", () => {
    const { md, container } = createRenderer();
    md.render("\n\n\n");
    expect(container.childNodes.length).toBe(0);
  });

  test("multiple code fences", () => {
    const { md, container } = createRenderer();
    md.render("```js\nconst a = 1;\n```\n\n```python\nb = 2\n```");
    const pres = container.querySelectorAll("pre");
    expect(pres.length).toBe(2);
    const codes = container.querySelectorAll("code");
    expect(codes[0].textContent).toBe("const a = 1;");
    expect(codes[0].className).toBe("language-js");
    expect(codes[1].textContent).toBe("b = 2");
    expect(codes[1].className).toBe("language-python");
  });

  test("code fence without closing stays open and content is safe", () => {
    const { md, container } = createRenderer();
    md.append("```js\nconst x = 1;\n");
    // Still in code fence - content should be in a code block
    const code = container.querySelector("code");
    expect(code).toBeTruthy();
    expect(code.textContent).toContain("const x = 1;");
    // Append more - still in code fence
    md.append("const y = 2;\n");
    expect(code.textContent).toContain("const y = 2;");
    // Close it
    md.append("```\n");
    expect(code.textContent).toBe("const x = 1;\nconst y = 2;");
  });

  test("blank lines inside fenced code are preserved", () => {
    const { md, container } = createRenderer();
    md.render("```js\nline1\n\nline2\n\n\nline3\n```");
    const code = container.querySelector("code");
    expect(code).toBeTruthy();
    expect(code.textContent).toBe("line1\n\nline2\n\n\nline3");
  });

  test("blank lines in fence via streaming append", () => {
    const { md, container } = createRenderer();
    md.append("```\na\n\nb\n");
    md.append("\nc\n```\n");
    const code = container.querySelector("code");
    expect(code).toBeTruthy();
    expect(code.textContent).toBe("a\n\nb\n\nc");
  });
});

describe("Streaming contract — mid-line splits", () => {
  const DOC = "# Hello\n\nSome **bold** text here.\n\n- item 1\n- item 2\n\n```js\nconst x = 1;\n```\n";

  function getSnapshot(container) {
    return container.innerHTML;
  }

  test("whole-string render is the baseline", () => {
    const { md, container } = createRenderer();
    md.render(DOC);
    const snapshot = getSnapshot(container);
    expect(snapshot).toContain("<h1>");
    expect(snapshot).toContain("<strong>");
    expect(snapshot).toContain("<li>");
    expect(snapshot).toContain("<code");
  });

  test("splitting at random mid-line positions produces identical DOM", () => {
    const { md: refMd, container: refContainer } = createRenderer();
    refMd.render(DOC);
    const baseline = getSnapshot(refContainer);

    const splitPoints = [3, 7, 12, 19, 25, 30, 37, 42, 50, 55];
    for (const pos of splitPoints) {
      const { md, container } = createRenderer();
      const a = DOC.slice(0, pos);
      const b = DOC.slice(pos);
      md.append(a);
      md.append(b);
      md.flush();
      expect(getSnapshot(container)).toBe(baseline);
    }
  });

  test("splitting at every single character boundary produces identical DOM", () => {
    const { md: refMd, container: refContainer } = createRenderer();
    refMd.render(DOC);
    const baseline = getSnapshot(refContainer);

    for (let i = 1; i < DOC.length; i++) {
      const { md, container } = createRenderer();
      md.append(DOC.slice(0, i));
      md.append(DOC.slice(i));
      md.flush();
      expect(getSnapshot(container)).toBe(baseline);
    }
  });

  test("flush() renders trailing partial without newline", () => {
    const { md, container } = createRenderer();
    md.append("# Hello");
    expect(container.querySelector("h1")).toBeFalsy();
    md.flush();
    expect(container.querySelector("h1")).toBeTruthy();
    expect(container.querySelector("h1").textContent).toBe("Hello");
  });

  test("render() resets partial buffer", () => {
    const { md, container } = createRenderer();
    md.append("# Partial");
    md.render("# Fresh");
    md.flush();
    expect(container.querySelector("h1").textContent).toBe("Fresh");
  });
});

describe("XSS hostile corpus", () => {
  test("script tag is inert", () => {
    const { md, container } = createRenderer();
    md.render('<script>alert(1)</script>');
    const scripts = container.querySelectorAll("script");
    expect(scripts.length).toBe(0);
    expect(container.textContent).toContain("alert(1)");
  });

  test("img with onerror is inert", () => {
    const { md, container } = createRenderer();
    md.render('<img src=x onerror=alert(1)>');
    const imgs = container.querySelectorAll("img");
    expect(imgs.length).toBe(0);
    expect(container.textContent).toContain("alert(1)");
  });

  test("javascript: link is stripped", () => {
    const { md, container } = createRenderer();
    md.render('<a href="javascript:alert(1)">click</a>');
    const links = container.querySelectorAll('a[href^="javascript:"]');
    expect(links.length).toBe(0);
    expect(container.textContent).toContain("click");
  });

  test("svg with onload is inert", () => {
    const { md, container } = createRenderer();
    md.render('<svg onload=alert(1)>');
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBe(0);
    expect(container.textContent).toContain("alert(1)");
  });

  test("image link with javascript: is inert", () => {
    const { md, container } = createRenderer();
    md.render('![xss](javascript:alert(1))');
    const imgs = container.querySelectorAll("img");
    expect(imgs.length).toBe(0);
    expect(container.textContent).toContain("alert(1)");
  });

  test("markdown link with javascript: is stripped", () => {
    const { md, container } = createRenderer();
    md.render('[link](javascript:alert(1))');
    const links = container.querySelectorAll('a[href^="javascript:"]');
    expect(links.length).toBe(0);
    expect(container.textContent).toContain("link");
  });

  test("iframe with javascript: is inert", () => {
    const { md, container } = createRenderer();
    md.render('<iframe src="javascript:alert(1)">');
    const iframes = container.querySelectorAll("iframe");
    expect(iframes.length).toBe(0);
    expect(container.textContent).toContain("alert(1)");
  });

  test("code with script tag inside is escaped", () => {
    const { md, container } = createRenderer();
    md.render('` code with <script> in it `');
    const code = container.querySelector("code");
    expect(code).toBeTruthy();
    expect(code.textContent).toBe("code with <script> in it");
    const scripts = container.querySelectorAll("script");
    expect(scripts.length).toBe(0);
  });

  test("bold with img onerror is escaped", () => {
    const { md, container } = createRenderer();
    md.render('**bold <img src=x onerror=alert(1)>**');
    const strong = container.querySelector("strong");
    expect(strong).toBeTruthy();
    expect(strong.textContent).toContain("alert(1)");
    const imgs = container.querySelectorAll("img");
    expect(imgs.length).toBe(0);
  });

  test("no HTML-parsing sinks anywhere in the renderer source", async () => {
    const src = await Bun.file(`${import.meta.dir}/markdown.js`).text();
    expect(src).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment|setHTML|DOMParser/);
  });
});
// ---------------------------------------------------------------------------
// Audit regressions (2026-10)
// ---------------------------------------------------------------------------
const ALLOWED = new Set(["div", "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "pre", "code",
  "strong", "em", "a", "table", "thead", "tbody", "tr", "th", "td", "blockquote"]);

function assertInert(container) {
  for (const el of container.querySelectorAll("*")) {
    expect(ALLOWED.has(el.localName)).toBe(true);
    for (const attr of el.attributes) {
      expect(attr.name.startsWith("on")).toBe(false);
      expect(["href", "target", "rel", "class", "data-block"]).toContain(attr.name);
    }
    if (el.localName === "a") expect(el.getAttribute("href")).toMatch(/^https?:\/\//i);
  }
}

describe("MarkdownRenderer XSS payloads", () => {
  const payloads = [
    "[x](javascript:alert(1))",
    "[x]( javascript:alert(1))",
    "[x](JaVaScRiPt:alert(1))",
    "[x](&#106;avascript:alert(1))",
    "[x](&#x6A;avascript:alert(1))",
    "[x](data:text/html,<script>alert(1)</script>)",
    "[x](vbscript:msgbox(1))",
    "[x](//evil.example/path)",
    '[x](https://ok.example/" onmouseover="alert(1))',
    "[x](https://ok.example/\"><img src=x onerror=alert(1)>)",
    "[<img src=x onerror=alert(1)>](https://ok.example)",
    "```\"><script>alert(1)</script>\n<img src=x onerror=alert(1)>\n```",
    "```js onload=alert(1)\ncode\n```",
    "| <script>alert(1)</script> | <b onclick=x>b</b> |\n|---|---|\n| <iframe> | [x](javascript:1) |",
    "# <svg/onload=alert(1)>",
    "- <a href=javascript:alert(1)>x</a>",
    "**<style>*{}</style>**",
    "&lt;script&gt;alert(1)&lt;/script&gt;",
  ];
  for (const payload of payloads) {
    test(`inert: ${payload.slice(0, 50)}`, () => {
      const { md, container } = createRenderer();
      md.render(payload);
      assertInert(container);
      // the same payload streamed one character at a time
      const streamed = createRenderer();
      for (const ch of payload) streamed.md.append(ch);
      streamed.md.flush();
      assertInert(streamed.container);
    });
  }

  test("a quote in an https URL stays inside the href attribute", () => {
    const { md, container } = createRenderer();
    md.render('[x](https://ok.example/" onmouseover="alert(1))');
    const a = container.querySelector("a");
    expect(a.getAttribute("onmouseover")).toBeNull();
    expect(a.getAttribute("href")).toBe('https://ok.example/" onmouseover="alert(1');
  });
});

describe("MarkdownRenderer block boundaries", () => {
  test("an indented closing fence (code inside a list item) closes the block", () => {
    const { md, container } = createRenderer();
    md.render("- step one\n  ```sh\n  make\n  ```\n\nAfter the code.");
    expect(container.querySelector("pre code").textContent).toBe("  make");
    const p = container.querySelector("p");
    expect(p && p.textContent).toBe("After the code.");
  });

  test("two tables separated by a blank line stay two tables", () => {
    const { md, container } = createRenderer();
    md.render("| a |\n|---|\n| 1 |\n\n| b |\n|---|\n| 2 |");
    const tables = container.querySelectorAll("table");
    expect(tables.length).toBe(2);
    expect(tables[1].querySelector("th").textContent).toBe("b");
  });

  test("a paragraph between two tables ends the first table", () => {
    const { md, container } = createRenderer();
    md.render("| a |\n|---|\n| 1 |\ntext\n| b |\n|---|\n| 2 |");
    expect(container.querySelectorAll("table").length).toBe(2);
  });

  test("CRLF line endings render like LF", () => {
    const lf = createRenderer();
    lf.md.render("# Title\n\n```js\nx\n```\n- a\n- b");
    const crlf = createRenderer();
    crlf.md.render("# Title\r\n\r\n```js\r\nx\r\n```\r\n- a\r\n- b");
    expect(crlf.container.innerHTML).toBe(lf.container.innerHTML);
  });

  test("CRLF split across chunks renders like LF", () => {
    const lf = createRenderer();
    lf.md.render("a\nb\n\nc");
    const crlf = createRenderer();
    for (const chunk of ["a\r", "\nb\r", "\n\r", "\nc"]) crlf.md.append(chunk);
    crlf.md.flush();
    expect(crlf.container.innerHTML).toBe(lf.container.innerHTML);
  });

  test("blockquotes render as blockquote, not as literal '>' text", () => {
    const { md, container } = createRenderer();
    md.render("> quoted **text**\n> more\n\nafter");
    const bq = container.querySelector("blockquote");
    expect(bq).toBeTruthy();
    expect(bq.textContent).toBe("quoted text more");
    expect(container.querySelector("[data-block=\"p\"] p").textContent).toBe("after");
  });
});
