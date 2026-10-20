// @vitest-environment node
import { describe, expect, it } from "vitest";
import { locationMatches, titleMatches } from "@/lib/scraper/ats/filters";
import { parseAtsConfig } from "@/lib/scraper/automation-run/config";

describe("strict title fragments", () => {
  it("matches any literal fragment with case, whitespace, and dash normalization", () => {
    expect(titleMatches("Senior ROBOTICS Software Engineer", ["controls", "robot"])).toBe(true);
    expect(titleMatches("Software–Engineer Intern", [" SOFTWARE   engineer "])).toBe(true);
    expect(titleMatches("Controls Engineer", ["robot"])).toBe(false);
    expect(titleMatches("C++ Systems Engineer", ["C++"])).toBe(true);
    expect(titleMatches("Engineer", [".*"])).toBe(false);
    expect(titleMatches("Engineer", [])).toBe(true);
  });
  it("can require whole words or phrases without demanding the full title", () => {
    expect(titleMatches("Internal Tools Engineer", ["intern"], "contains")).toBe(true);
    expect(titleMatches("Internal Tools Engineer", ["intern"], "words")).toBe(false);
    expect(titleMatches("Engineering Intern, Summer", ["intern"], "words")).toBe(true);
    expect(titleMatches("Senior Software Engineer II", ["software engineer"], "words")).toBe(true);
    expect(titleMatches("C++ Engineer", ["C++"], "words")).toBe(true);
    expect(titleMatches("C++ Engineer", ["C"], "words")).toBe(false);
  });
  it("keeps legacy configuration unrestricted and reads filters on every source", () => {
    expect(parseAtsConfig(JSON.stringify({ workday: { companies: [] } }), "workday")).toMatchObject({ titleContains: [], titleMatchMode: "contains" });
    for (const source of ["greenhouse", "lever", "ashby", "workday", "company-careers"] as const) {
      expect(parseAtsConfig(JSON.stringify({ [source]: { companies: [], titleContains: [" robot ", "", 42], titleMatchMode: "words" } }), source)).toMatchObject({ titleContains: ["robot"], titleMatchMode: "words" });
    }
  });
});

describe("country location aliases", () => {
  it.each(["US", "USA", "U.S.", "U.S.A.", "United States", "United States of America"])("recognizes %s in both directions", (country) => {
    expect(locationMatches("Seattle, " + country, ["United States"])).toBe(true);
    expect(locationMatches("Austin, United States", [country])).toBe(true);
  });
  it.each(["TW", "TWN", "Taiwan", "台灣", "臺灣", "台湾"])("recognizes %s as Taiwan", (country) => {
    expect(locationMatches("Taipei, " + country, ["Taiwan"])).toBe(true);
    expect(locationMatches("Hsinchu, Taiwan", [country])).toBe(true);
  });
  it("supports UK aliases and unspaced Han country/city addresses", () => {
    expect(locationMatches("London, U.K.", ["United Kingdom"])).toBe(true);
    expect(locationMatches("Manchester, United Kingdom", ["UK"])).toBe(true);
    expect(locationMatches("臺灣台北市", ["Taiwan"])).toBe(true);
  });
  it("avoids country-code substrings and does not infer countries from cities or ambiguous CA", () => {
    for (const location of ["Houston, TX", "Minsk, Belarus", "Sydney, Australia"]) expect(locationMatches(location, ["United States"])).toBe(false);
    expect(locationMatches("San Francisco, CA", ["Canada"])).toBe(false);
    expect(locationMatches("Toronto, Canada", ["CA"])).toBe(false);
    expect(locationMatches("Seattle, WA", ["United States"])).toBe(false);
    expect(locationMatches("Taipei", ["Taiwan"])).toBe(false);
    expect(locationMatches("Remote - US", ["Taiwan"])).toBe(false);
    expect(locationMatches("Remote - US", ["Taiwan", "USA"])).toBe(true);
    expect(locationMatches("Remote", ["US"])).toBe(false);
    expect(locationMatches("Remote", ["Remote"])).toBe(true);
  });
});
