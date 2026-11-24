// Central limits and switches. Everything tunable lives here so ops can change it in one place.
export const config = {
  siteName: process.env.SITE_NAME ?? "nosorry",
  /** Who runs this instance, shown on /about. Leave empty and the page says so instead of inventing anything. */
  operator: {
    name: process.env.OPERATOR_NAME ?? "",
    url: process.env.OPERATOR_URL ?? "",              // https://… (organisation or person page)
    contact: process.env.OPERATOR_CONTACT ?? "",      // an email address or an https:// contact page
    security: process.env.SECURITY_CONTACT ?? "",     // where to report a checker bypass privately
    description: process.env.OPERATOR_DESCRIPTION ?? "", // one sentence: who you are, how the site is funded
  },
  requireEmailVerification: process.env.REQUIRE_EMAIL_VERIFICATION === "true",
  sessionDays: 30,
  limits: {
    leanSourceBytes: 1_000_000,
    transcriptBytes: 8_000_000,
    bodyBytes: 100_000,
    bulkMaxItems: 100,
    // per account, per hour
    submissionsPerHour: Number(process.env.LIMIT_SUBMISSIONS_PER_HOUR ?? 120),
    // new accounts are throttled harder for their first day (anti-spam without email checks)
    newAccountSubmissionsPerHour: 20,
    pendingJobsPerUser: 200,
    signupsPerIpPerHour: 5,
    loginsPerIpPer15m: 20,
  },
  toolchain: process.env.LEAN_TOOLCHAIN ?? "leanprover/lean4:v4.33.1",
  allowedAxioms: ["propext", "Classical.choice", "Quot.sound"],
};
