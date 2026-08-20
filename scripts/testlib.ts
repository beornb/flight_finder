#!/usr/bin/env bun
import { testAllApiKeys, type ApiTestResult, type ApiTestStatus } from "../src/lib/api-tester";

// ANSI Color helper codes for standard terminal formatting
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

function formatStatus(status: ApiTestStatus): string {
  switch (status) {
    case "OK":
      return `${colors.green}${colors.bold}[PASS]${colors.reset}`;
    case "INVALID_KEY":
      return `${colors.red}${colors.bold}[INVALID KEY]${colors.reset}`;
    case "EXPIRED_CREDITS":
      return `${colors.yellow}${colors.bold}[OUT OF CREDITS]${colors.reset}`;
    case "RATE_LIMITED":
      return `${colors.yellow}${colors.bold}[RATE LIMITED]${colors.reset}`;
    case "SKIPPED":
      return `${colors.dim}[SKIPPED]${colors.reset}`;
    case "NOT_CONFIGURED":
      return `${colors.dim}[NOT CONFIGURED]${colors.reset}`;
    case "ERROR":
      return `${colors.red}${colors.bold}[FAIL]${colors.reset}`;
  }
}

type ParsedArgs = {
  origin?: string;
  destination?: string;
  days?: number;
  provider?: string;
  json?: boolean;
  help?: boolean;
};

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const options: ParsedArgs = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg.startsWith("--origin=")) {
      options.origin = arg.split("=")[1];
    } else if (arg === "-o" && args[i + 1]) {
      options.origin = args[++i];
    } else if (arg.startsWith("--destination=")) {
      options.destination = arg.split("=")[1];
    } else if (arg === "-d" && args[i + 1]) {
      options.destination = args[++i];
    } else if (arg.startsWith("--days=")) {
      options.days = parseInt(arg.split("=")[1], 10);
    } else if (arg.startsWith("--provider=")) {
      options.provider = arg.split("=")[1];
    } else if (arg === "-p" && args[i + 1]) {
      options.provider = args[++i];
    }
  }

  return options;
}

function printHelp() {
  console.log(`
${colors.cyan}${colors.bold}Flight Finder API Testing Utility${colors.reset}

Usage:
  ${colors.bold}bun run testlib${colors.reset} [options]

Options:
  ${colors.bold}-p, --provider <name>${colors.reset}   Filter test to a single provider (ignav, duffel, serpapi, mock, db)
  ${colors.bold}-o, --origin <iata>${colors.reset}     Origin IATA code for sample query (default: VIE)
  ${colors.bold}-d, --destination <iata>${colors.reset} Destination IATA code for sample query (default: LHR)
  ${colors.bold}--days <number>${colors.reset}          Days in future for sample query date (default: 30)
  ${colors.bold}--json${colors.reset}                   Output results as JSON
  ${colors.bold}-h, --help${colors.reset}               Show this help message

Examples:
  bun run testlib
  bun run testlib --provider=duffel
  bun run testlib --origin=JFK --destination=LHR --days=45
`);
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (options.json) {
    const results = await testAllApiKeys({
      origin: options.origin,
      destination: options.destination,
      daysInFuture: options.days,
      filterProvider: options.provider,
    });
    console.log(JSON.stringify(results, null, 2));
    const failed = results.some((r) => r.status === "INVALID_KEY" || r.status === "EXPIRED_CREDITS" || r.status === "ERROR");
    process.exit(failed ? 1 : 0);
  }

  console.log("");
  console.log(`${colors.cyan}${colors.bold}✈️  FLIGHT FINDER — API KEY TEST RUNNER & HEALTH CHECK${colors.reset}`);
  console.log(`${colors.dim}==============================================================${colors.reset}`);
  console.log(
    `Sample Query: ${colors.bold}${options.origin ?? "VIE"}${colors.reset} ✈ ${colors.bold}${
      options.destination ?? "LHR"
    }${colors.reset} (Date offset: +${options.days ?? 30} days)`
  );
  console.log(`${colors.dim}Testing API provider credentials & backend connectivity...${colors.reset}\n`);

  const results = await testAllApiKeys({
    origin: options.origin,
    destination: options.destination,
    daysInFuture: options.days,
    filterProvider: options.provider,
  });

  let totalConfigured = 0;
  let totalPassed = 0;
  let totalFailed = 0;

  for (const r of results) {
    if (r.status !== "NOT_CONFIGURED") {
      totalConfigured++;
    }

    const keyLabel = r.keyMasked ? ` (${colors.dim}${r.keyMasked}${colors.reset})` : "";
    const timeLabel = r.durationMs > 0 ? ` ${colors.dim}[${r.durationMs}ms]${colors.reset}` : "";

    console.log(
      `${formatStatus(r.status)} ${colors.bold}${r.provider.padEnd(25)}${colors.reset}${keyLabel}${timeLabel}`
    );
    console.log(`       ${colors.dim}└─ ${r.message}${colors.reset}`);

    if (r.status === "OK") {
      totalPassed++;
    } else if (r.status === "INVALID_KEY" || r.status === "EXPIRED_CREDITS" || r.status === "ERROR") {
      totalFailed++;
    }
  }

  console.log(`\n${colors.dim}--------------------------------------------------------------${colors.reset}`);
  console.log(`${colors.bold}SUMMARY:${colors.reset}`);
  console.log(`  Total Checks  : ${results.length}`);
  console.log(`  Configured    : ${totalConfigured}`);
  console.log(`  Passed        : ${colors.green}${totalPassed}${colors.reset}`);
  if (totalFailed > 0) {
    console.log(`  Failed        : ${colors.red}${totalFailed}${colors.reset}`);
  } else {
    console.log(`  Failed        : 0`);
  }

  if (totalFailed > 0) {
    console.log(`\n${colors.yellow}${colors.bold}⚠️ ATTENTION REQUIRED:${colors.reset}`);
    console.log(`One or more configured API keys appear to be expired, invalid, or out of credits.`);
    console.log(`Please update your ${colors.bold}.env${colors.reset} file with active credentials.`);
  } else if (results.some((r) => r.status === "SKIPPED")) {
    console.log(`\n${colors.yellow}${colors.bold}SEARCH_DRY_RUN is on: no provider key was actually verified.${colors.reset}`);
  } else {
    console.log(`\n${colors.green}${colors.bold}✨ All configured API keys and services are operating normally!${colors.reset}`);
  }
  console.log("");

  // Exit code 1 if any live provider fails
  const liveProviderFailures = results.filter(
    (r) =>
      r.keyName !== "FLIGHT_PROVIDER" &&
      r.status !== "NOT_CONFIGURED" &&
      r.status !== "SKIPPED" &&
      r.status !== "OK"
  );

  if (liveProviderFailures.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`${colors.red}Fatal error running API tests:${colors.reset}`, err);
  process.exit(1);
});
