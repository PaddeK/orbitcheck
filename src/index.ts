import { version } from "../package.json";
import { Checker } from "./check.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { Epublift } from "./epublift.ts";
import { log } from "./log.ts";
import { Replacer } from "./replace.ts";
import { serveReports } from "./report.ts";
import { epubsanaVersion } from "./repairer.ts";
import { STATE_FILE, State, type StateData } from "./state.ts";
import { epubveriVersion } from "./validator.ts";

const args = process.argv.slice(2);

// The container image has no shell, so Docker's HEALTHCHECK runs the binary itself: orbitcheck --healthcheck.
// Healthy if a cycle succeeded, or a book was checked, within two intervals (the first run over a big library takes a while).
if (args.includes("--healthcheck")) {
    const dataDir = process.env.DATA_DIR ?? "/data";
    const intervalMs = Number(process.env.CHECK_INTERVAL ?? 300) * 1000;
    const state = (await Bun.file(`${dataDir}/${STATE_FILE}`).json().catch(() => null)) as Partial<StateData> | null;
    const last = Math.max(state?.lastSuccess ?? 0, state?.lastProgress ?? 0);
    process.exit(Date.now() - last <= 2 * intervalMs + 120_000 ? 0 : 1);
}
if (args.includes("--version")) {
    console.log(`${version} (epubveri ${epubveriVersion}, epubsana ${epubsanaVersion})`);
    process.exit(0);
}
const once = args.includes("--once");

let config;
try {
    config = loadConfig();
} catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    log.error(err.message);
    process.exit(2);
}

let state: State;
try {
    state = await State.open(config.dataDir);
} catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EACCES" && code !== "EPERM") throw err;
    const uid = process.getuid?.() ?? "?";
    const gid = process.getgid?.() ?? "?";
    log.error(`Cannot write to ${config.dataDir} as uid ${uid}. If it is a bind mount, create the directory on the host`
        + ` and give it to this user, e.g.:\n\n  mkdir -p /path/on/host && sudo chown ${uid}:${gid} /path/on/host\n`);
    process.exit(1);
}

let epublift: Epublift | undefined;
if (config.epublift) {
    epublift = (await Epublift.find(config.epubliftPath, `${config.dataDir}/tmp`)) ?? undefined;
    if (!epublift) log.error(`EPUBLIFT is on, but "${config.epubliftPath}" cannot be run (EPUBLIFT_PATH); upgrades are not offered`);
}
const checker = new Checker(config, state, epublift);
log.info(`orbitcheck ${version} with epubveri ${epubveriVersion}, epubsana ${epubsanaVersion}${epublift ? ` and epublift ${epublift.version}` : ""}, checking every ${config.checkInterval}s`
    + `${config.dryRun ? " (dry run: nothing is changed in BookOrbit)" : ""}`);
try {
    log.info(`BookOrbit: logged in as ${await checker.bookorbit.checkAuth()}`);
} catch (err) {
    log.error(`BookOrbit: ${(err as Error).message}`);
}
if (!once) {
    // Replacing books needs the dry run off: it changes the library, which a dry run promises not to
    const replacer = config.replaceInLibrary && !config.dryRun ? new Replacer(config, state, checker) : undefined;
    serveReports(config, state, checker, replacer);
    log.info(`reports on port ${config.port}${config.reportAuth ? " (login required)" : ""}${config.reportUrl ? `, linked in BookOrbit as ${config.reportUrl}` : " (set REPORT_URL to link them in BookOrbit)"}`
        + `${replacer ? "; books can be replaced in the library" : ""}`);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
        await state.save();
        process.exit(0);
    });
}

// After a failed cycle, try again within a minute: when BookOrbit restarts with this container, it is not up yet
const RETRY_SECONDS = 60;

for (;;) {
    let failed = false;
    try {
        await checker.cycle();
    } catch (err) {
        // Keep running through outages; the healthcheck reports lasting failures
        log.error(`cycle failed: ${(err as Error).message}`);
        if (once) process.exit(1);
        failed = true;
    }
    if (once) process.exit(0);
    await Bun.sleep(Math.min(failed ? RETRY_SECONDS : Infinity, config.checkInterval) * 1000);
}
