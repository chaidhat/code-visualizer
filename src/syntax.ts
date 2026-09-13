import Prism from "prismjs";
import "prismjs/components/prism-typescript.js";
import "prismjs/components/prism-jsx.js";
import "prismjs/components/prism-tsx.js";

export interface SyntaxSpan {
  start: number;
  end: number;
  color: string;
}

const colors: Record<string, string> = {
  comment: "gray",
  prolog: "gray",
  keyword: "magenta",
  boolean: "magenta",
  string: "green",
  "template-string": "green",
  regex: "green",
  number: "yellow",
  function: "blueBright",
  "class-name": "cyan",
  builtin: "cyan",
  operator: "cyan",
  punctuation: "gray",
  tag: "cyan",
  "attr-name": "yellow",
  "attr-value": "green",
};

/** Tokenize together so multiline strings and comments keep their context. */
export function syntaxSpans(source: string, file: string): SyntaxSpan[] {
  const language = /\.[jt]sx$/i.test(file) ? "tsx" : "typescript";
  const spans: SyntaxSpan[] = [];
  let offset = 0;
  function visit(
    value: string | Prism.Token | (string | Prism.Token)[],
    color?: string,
  ): void {
    if (typeof value === "string") {
      if (color && value.length)
        spans.push({ start: offset, end: offset + value.length, color });
      offset += value.length;
    } else if (Array.isArray(value)) {
      for (const child of value) visit(child, color);
    } else {
      visit(value.content, colors[value.type] ?? color);
    }
  }
  visit(Prism.tokenize(source, Prism.languages[language]));
  return spans;
}
