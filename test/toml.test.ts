import { describe, expect, it } from "vitest";
import { parseToml, readValue, TomlError } from "../src/toml.js";

/** Checks tables, dotted tables, every value type, comments and lists on several lines. */
function readsTheSupportedSubset(): void {
  const text = [
    "# comment",
    'name = "a # not a comment" # comment',
    "literal = 'raw\\text'",
    "enabled = true",
    "disabled = false",
    "count = -12",
    "[network]",
    'allow = ["a.example", "b.example",]',
    "multi = [",
    '  "c.example", # first',
    '  "d.example",',
    "]",
    '[secrets."MY_KEY"]',
    'host = "api.example"',
    '"quoted key" = "value"',
  ].join("\n");
  expect(parseToml(text)).toEqual({
    name: "a # not a comment",
    literal: "raw\\text",
    enabled: true,
    disabled: false,
    count: -12,
    network: { allow: ["a.example", "b.example"], multi: ["c.example", "d.example"] },
    secrets: { MY_KEY: { host: "api.example", "quoted key": "value" } },
  });
}

/** Checks quotes inside texts and escaped quotes. */
function keepsQuotesInsideTexts(): void {
  expect(readValue('"say \\"hi\\" #1"', 1)).toBe('say "hi" #1');
  expect(parseToml("a = [\"x, y\", 'z']")).toEqual({ a: ["x, y", "z"] });
  expect(parseToml("a = \"it's\" # c")).toEqual({ a: "it's" });
  expect(parseToml("a = ['say \"x\"', \"y\"]")).toEqual({ a: ['say "x"', "y"] });
}

/** Checks that wrong lines are refused with their line number. */
function refusesWrongLines(): void {
  expect(parseToml.bind(undefined, "\nnot a line")).toThrow("line 2");
  expect(parseToml.bind(undefined, "a = 1.5")).toThrow(TomlError);
  expect(parseToml.bind(undefined, 'a = "open')).toThrow("is not closed");
  expect(parseToml.bind(undefined, "a = 1\n[a]")).toThrow("already a value");
  expect(parseToml.bind(undefined, "a = [1]\n[a.b]")).toThrow("already a value");
}

describe("toml", describeToml);

/** Groups the TOML tests. */
function describeToml(): void {
  it("reads the supported subset", readsTheSupportedSubset);
  it("keeps quotes inside texts", keepsQuotesInsideTexts);
  it("refuses wrong lines", refusesWrongLines);
}
