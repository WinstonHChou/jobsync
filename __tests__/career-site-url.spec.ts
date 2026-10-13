import { describe, expect, it } from "vitest";
import { isPublicCareerIp, normalizeCareerSiteUrl, parseCareerSiteUrl, requiresCareerSiteAuthorization } from "@/lib/careerSiteUrl";
import { CompanyCareersCompanySchema, CreateAutomationSchema } from "@/models/automation.schema";
import { companyBoardUrl } from "@/lib/atsBoardUrl";
import { parseEditSourceConfig } from "@/components/automations/automation-wizard/wizardConfig";

describe("company careers URLs", () => {
  it.each(["http://careers.example.com", "https://localhost", "https://local.test.internal", "https://127.0.0.1/jobs", "https://0x7f000001/jobs", "https://2130706433/jobs", "https://10.0.0.1", "https://169.254.169.254", "https://[::1]", "https://[::ffff:127.0.0.1]", "https://[fc00::1]", "https://user:pass@careers.example.com", "https://careers.example.com:8443", "https://careers.example.com\\jobs"])("rejects unsafe URL %s", (url) => expect(parseCareerSiteUrl(url)).toBeNull());
  it.each(["100.64.0.1", "172.16.1.1", "192.168.2.1", "198.18.0.1", "192.0.2.1", "203.0.113.1", "224.0.0.1", "2001:db8::1", "2002:7f00:1::", "fe80::1"])("rejects private/reserved address %s", (ip) => expect(isPublicCareerIp(ip)).toBe(false));
  it.each(["8.8.8.8", "142.250.80.46", "2606:4700:4700::1111"])("accepts public address %s", (ip) => expect(isPublicCareerIp(ip)).toBe(true));
  it("starts at the first page while preserving search filters", () => {
    expect(normalizeCareerSiteUrl("https://careers.example.com/jobs?q=intern&location=Boston&page=3&utm_source=alert#jobs")).toBe("https://careers.example.com/jobs?location=Boston&q=intern");
    expect(normalizeCareerSiteUrl("https://www.google.com/about/careers/applications/?q=intern&page=3")).toBe("https://www.google.com/about/careers/applications/jobs/results/?q=intern");
    expect(normalizeCareerSiteUrl("https://careers.bcg.com/global/en/search-results?from=10&keywords=intern")).toBe("https://careers.bcg.com/global/en/search-results?keywords=intern");
  });
  it("rejects Meta until an authorized adapter exists", () => {
    expect(requiresCareerSiteAuthorization(new URL("https://www.metacareers.com/jobsearch/"))).toBe(true);
    expect(CompanyCareersCompanySchema.safeParse({ name: "Meta", token: "https://www.metacareers.com/jobsearch/" }).success).toBe(false);
    expect(CompanyCareersCompanySchema.safeParse({ name: "Meta", token: "https://www.metacareers.com./jobsearch/" }).success).toBe(false);
  });
  it("round trips through automation edit config and board links", () => {
    const sourceConfig = { "company-careers": { companies: [{ name: "Acme", token: "https://careers.example.com/jobs?page=3&q=intern" }] } };
    const parsed = CreateAutomationSchema.parse({ name: "Interns", jobBoard: "company-careers", sourceConfig, resumeId: "550e8400-e29b-41d4-a716-446655440000", matchThreshold: 80, scheduleHour: 8 });
    expect(parsed.sourceConfig?.["company-careers"]?.companies[0].token).toBe("https://careers.example.com/jobs?q=intern");
    expect(parseEditSourceConfig(JSON.stringify(parsed.sourceConfig))).toEqual(parsed.sourceConfig);
    expect(companyBoardUrl("company-careers", parsed.sourceConfig!["company-careers"]!.companies[0])).toBe("https://careers.example.com/jobs?q=intern");
  });
});
