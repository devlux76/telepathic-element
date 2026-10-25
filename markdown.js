// markdown.js — XSS-safe streaming markdown renderer for chat/LLM output.
// Builds DOM nodes directly (createElement/textContent; never parses HTML),
// so raw HTML in the input is shown as text. Links are kept only for
// http(s) URLs. Zero dependencies.
//
//   const md = new MarkdownRenderer(container);
//   md.append(chunk);   // as deltas arrive; complete lines render immediately
//   md.flush();         // at end of stream: renders the trailing partial line
//   md.render(text);    // replace everything with a whole document
//
// Supported: # headings, paragraphs, **bold**, *italic*, ***both***, `code`,
// ``` fenced code ```, - / * / + and 1. lists, > blockquotes, | tables |,
// [text](https://url).

export class MarkdownRenderer {
  #doc;
  #container;
  #state = "text";
  #fenceLang = null;
  #openBlock = null;
  #openBlockType = null;
  #partial = "";

  constructor(container) {
    this.#container = container;
    this.#doc = container.ownerDocument;
  }

  render(text) {
    this.#container.textContent = "";
    this.#state = "text";
    this.#fenceLang = null;
    this.#openBlock = null;
    this.#openBlockType = null;
    this.#partial = "";
    if (text) this.append(text);
    this.flush();
  }

  append(chunk) {
    const combined = this.#partial + chunk;
    const lastNewline = combined.lastIndexOf("\n");
    if (lastNewline === -1) {
      this.#partial = combined;
      return;
    }
    this.#partial = combined.slice(lastNewline + 1);
    const text = combined.slice(0, lastNewline);
    const lines = text.split("\n");
    for (const line of lines) {
      this.#processLine(line);
    }
  }

  flush() {
    if (this.#partial) {
      this.#processLine(this.#partial);
      this.#partial = "";
    }
  }

  #el(tag, attrs) {
    const el = this.#doc.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        el.setAttribute(k, v);
      }
    }
    return el;
  }

  #text(str) {
    return this.#doc.createTextNode(str);
  }

  #processLine(line) {
    if (line.endsWith("\r")) line = line.slice(0, -1); // CRLF input
    if (this.#state === "code") {
      if (line.trim() === "```") {
        // Closing fence; may be indented like its opener (e.g. in a list item).
        this.#state = "text";
        this.#openBlock = null;
        this.#openBlockType = null;
        return;
      }
      const code = this.#openBlock ? this.#openBlock.querySelector("code") : null;
      if (code) {
        code.textContent += (code.textContent ? "\n" : "") + line;
      }
      return;
    }

    const trimmed = line.trimStart();

    if (trimmed === "") {
      this.#closeOpenBlock();
      return;
    }

    if (trimmed.startsWith("```")) {
      this.#closeOpenBlock();
      this.#fenceLang = trimmed.slice(3).trim() || null;
      const pre = this.#el("pre");
      const code = this.#el("code");
      if (this.#fenceLang) {
        code.setAttribute("class", `language-${this.#fenceLang}`);
      }
      pre.appendChild(code);
      this.#container.appendChild(pre);
      this.#openBlock = pre;
      this.#openBlockType = "fence";
      this.#state = "code";
      return;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      this.#closeOpenBlock();
      const level = headingMatch[1].length;
      const h = this.#el(`h${level}`);
      this.#parseInline(h, headingMatch[2]);
      this.#container.appendChild(h);
      return;
    }

    const ulMatch = trimmed.match(/^[-*+]\s+(.*)/);
    if (ulMatch) {
      if (this.#openBlockType !== "ul") {
        this.#closeOpenBlock();
        const wrapper = this.#el("div");
        wrapper.dataset.block = "ul";
        const ul = this.#el("ul");
        wrapper.appendChild(ul);
        this.#container.appendChild(wrapper);
        this.#openBlock = wrapper;
        this.#openBlockType = "ul";
      }
      const li = this.#el("li");
      this.#parseInline(li, ulMatch[1]);
      this.#openBlock.firstChild.appendChild(li);
      return;
    }

    const olMatch = trimmed.match(/^\d+\.\s+(.*)/);
    if (olMatch) {
      if (this.#openBlockType !== "ol") {
        this.#closeOpenBlock();
        const wrapper = this.#el("div");
        wrapper.dataset.block = "ol";
        const ol = this.#el("ol");
        wrapper.appendChild(ol);
        this.#container.appendChild(wrapper);
        this.#openBlock = wrapper;
        this.#openBlockType = "ol";
      }
      const li = this.#el("li");
      this.#parseInline(li, olMatch[1]);
      this.#openBlock.firstChild.appendChild(li);
      return;
    }

    if (trimmed.startsWith("|")) {
      this.#processTableRow(trimmed);
      return;
    }

    const quoteMatch = trimmed.match(/^>\s?(.*)/);
    if (quoteMatch) {
      if (this.#openBlockType !== "quote") {
        this.#closeOpenBlock();
        const wrapper = this.#el("div");
        wrapper.dataset.block = "quote";
        const blockquote = this.#el("blockquote");
        blockquote.appendChild(this.#el("p"));
        wrapper.appendChild(blockquote);
        this.#container.appendChild(wrapper);
        this.#openBlock = wrapper;
        this.#openBlockType = "quote";
      }
      const qp = this.#openBlock.firstChild.firstChild;
      if (quoteMatch[1]) {
        if (qp.childNodes.length > 0) qp.appendChild(this.#text(" "));
        this.#parseInline(qp, quoteMatch[1]);
      }
      return;
    }

    if (this.#openBlockType !== "p") {
      this.#closeOpenBlock();
      const wrapper = this.#el("div");
      wrapper.dataset.block = "p";
      const p = this.#el("p");
      wrapper.appendChild(p);
      this.#container.appendChild(wrapper);
      this.#openBlock = wrapper;
      this.#openBlockType = "p";
    }
    const p = this.#openBlock.firstChild;
    if (p.childNodes.length > 0) {
      p.appendChild(this.#text(" "));
    }
    this.#parseInline(p, trimmed);
  }

  #processTableRow(line) {
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length === 0) return;
    // The |---|:-:| alignment row carries no content.
    if (this.#openBlockType === "table" && cells.every((c) => /^:?-+:?$/.test(c))) return;

    let table;
    if (this.#openBlockType === "table") {
      table = this.#openBlock.firstChild;
    } else {
      this.#closeOpenBlock();
      const wrapper = this.#el("div");
      wrapper.dataset.block = "table";
      table = this.#el("table");
      wrapper.appendChild(table);
      this.#container.appendChild(wrapper);
      this.#openBlock = wrapper;
      this.#openBlockType = "table";
    }

    const isHeader = !table.querySelector("tbody");
    if (isHeader) {
      let thead = table.querySelector("thead");
      if (!thead) {
        thead = this.#el("thead");
        table.appendChild(thead);
      }
      const tr = this.#el("tr");
      for (const cell of cells) {
        const th = this.#el("th");
        this.#parseInline(th, cell);
        tr.appendChild(th);
      }
      thead.appendChild(tr);

      const tbody = this.#el("tbody");
      table.appendChild(tbody);
    } else {
      const tbody = table.querySelector("tbody");
      const tr = this.#el("tr");
      for (const cell of cells) {
        const td = this.#el("td");
        this.#parseInline(td, cell);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }

  #closeOpenBlock() {
    this.#openBlock = null;
    this.#openBlockType = null;
  }

  #parseInline(parent, text) {
    let rest = text;
    while (rest.length > 0) {
      let m = rest.match(/^`\s*([^`]+?)\s*`/);
      if (m) {
        const code = this.#el("code");
        code.textContent = m[1];
        parent.appendChild(code);
        rest = rest.slice(m[0].length);
        continue;
      }

      m = rest.match(/^\*\*\*(.+?)\*\*\*/);
      if (m) {
        const strong = this.#el("strong");
        const em = this.#el("em");
        em.textContent = m[1];
        strong.appendChild(em);
        parent.appendChild(strong);
        rest = rest.slice(m[0].length);
        continue;
      }

      m = rest.match(/^\*\*(.+?)\*\*/);
      if (m) {
        const strong = this.#el("strong");
        strong.textContent = m[1];
        parent.appendChild(strong);
        rest = rest.slice(m[0].length);
        continue;
      }

      m = rest.match(/^\*(.+?)\*/);
      if (m) {
        const em = this.#el("em");
        em.textContent = m[1];
        parent.appendChild(em);
        rest = rest.slice(m[0].length);
        continue;
      }

      m = rest.match(/^\[([^\]]+)\]\(([^)]+)\)/);
      if (m) {
        const href = m[2];
        if (/^https?:\/\//i.test(href)) {
          const a = this.#el("a", { href, target: "_blank", rel: "noopener noreferrer" });
          a.textContent = m[1];
          parent.appendChild(a);
        } else {
          parent.appendChild(this.#text(`[${m[1]}](${m[2]})`));
        }
        rest = rest.slice(m[0].length);
        continue;
      }

      m = rest.match(/^[^`*\[]+/);
      if (m) {
        parent.appendChild(this.#text(m[0]));
        rest = rest.slice(m[0].length);
        continue;
      }

      parent.appendChild(this.#text(rest[0]));
      rest = rest.slice(1);
    }
  }
}