import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError, loadConfig } from "../src/config.ts";
import { STATE_FILE } from "../src/state.ts";

const env = {
    BOOKORBIT_URL: "https://books.example.org/",
    BOOKORBIT_USER: "reader",
    BOOKORBIT_PASSWORD: "bo-secret",
};

test("defaults", () => {
    expect(loadConfig(env)).toEqual({
        bookorbitUrl: "https://books.example.org",
        bookorbitUser: "reader",
        bookorbitPassword: "bo-secret",
        bookorbitPublicUrl: "https://books.example.org",
        reportUrl: undefined,
        port: 8080,
        reportAuth: undefined,
        checkInterval: 300,
        maxFileSize: 200 * 1024 * 1024,
        dataDir: "/data",
        dryRun: false,
        orbitcheckFixes: false,
        epublift: false,
        epubliftPath: "epublift",
        replaceInLibrary: false,
    });
});

test("every missing required setting is named at once", () => {
    expect(() => loadConfig({})).toThrow("BOOKORBIT_URL, BOOKORBIT_USER, BOOKORBIT_PASSWORD");
});

test("settings can come from files (Docker secrets)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orbitcheck-config-"));
    await writeFile(join(dir, "password"), "from-file\n");
    expect(loadConfig({ ...env, BOOKORBIT_PASSWORD: undefined, BOOKORBIT_PASSWORD_FILE: join(dir, "password") }).bookorbitPassword).toBe("from-file");
    expect(() => loadConfig({ ...env, BOOKORBIT_PASSWORD_FILE: join(dir, "missing") })).toThrow(ConfigError);
});

test("optional settings", () => {
    const config = loadConfig({
        ...env, REPORT_URL: "http://192.168.1.139:8080/", PORT: "9000", CHECK_INTERVAL: "3600", MAX_FILE_SIZE_MB: "50", DRY_RUN: "yes",
    });
    expect(config.reportUrl).toBe("http://192.168.1.139:8080");
    expect(config.port).toBe(9000);
    expect(config.checkInterval).toBe(3600);
    expect(config.maxFileSize).toBe(50 * 1024 * 1024);
    expect(config.dryRun).toBe(true);
    expect(loadConfig({ ...env, ORBITCHECK_FIXES: "true" }).orbitcheckFixes).toBe(true);
    expect(loadConfig({ ...env, EPUBLIFT: "true", EPUBLIFT_PATH: "/usr/local/bin/epublift" })).toMatchObject({ epublift: true, epubliftPath: "/usr/local/bin/epublift" });
});

test("REPORT_PASSWORD protects the report pages, as user orbitcheck unless REPORT_USER says otherwise", () => {
    expect(loadConfig({ ...env, REPORT_PASSWORD: "ishmael" }).reportAuth).toEqual({ user: "orbitcheck", password: "ishmael" });
    expect(loadConfig({ ...env, REPORT_USER: "ahab", REPORT_PASSWORD: "ishmael" }).reportAuth).toEqual({ user: "ahab", password: "ishmael" });
    expect(() => loadConfig({ ...env, REPORT_USER: "ahab" })).toThrow("REPORT_USER needs REPORT_PASSWORD");
});

test("BOOKORBIT_PUBLIC_URL is for links, when BOOKORBIT_URL is an internal address", () => {
    const config = loadConfig({ ...env, BOOKORBIT_URL: "http://app:3000", BOOKORBIT_PUBLIC_URL: "https://books.example.org/" });
    expect(config.bookorbitUrl).toBe("http://app:3000");
    expect(config.bookorbitPublicUrl).toBe("https://books.example.org");
    expect(() => loadConfig({ ...env, BOOKORBIT_PUBLIC_URL: "books.example.org" })).toThrow("BOOKORBIT_PUBLIC_URL");
});

test("invalid values are rejected", () => {
    expect(() => loadConfig({ ...env, BOOKORBIT_URL: "books.example.org" })).toThrow("BOOKORBIT_URL");
    expect(() => loadConfig({ ...env, REPORT_URL: "192.168.1.139:8080" })).toThrow("REPORT_URL");
    expect(() => loadConfig({ ...env, CHECK_INTERVAL: "30" })).toThrow("at least 60");
    expect(() => loadConfig({ ...env, MAX_FILE_SIZE_MB: "lots" })).toThrow("whole number");
});

async function healthcheck(state: object | null, interval = "300"): Promise<number> {
    const dir = await mkdtemp(join(tmpdir(), "orbitcheck-health-"));
    if (state) await writeFile(join(dir, STATE_FILE), JSON.stringify(state));
    const proc = Bun.spawn([process.execPath, "src/index.ts", "--healthcheck"], {
        env: { ...process.env, DATA_DIR: dir, CHECK_INTERVAL: interval },
    });
    return proc.exited;
}

test("healthcheck: healthy after a recent cycle or while a long first run makes progress", async () => {
    expect(await healthcheck({ lastSuccess: Date.now() })).toBe(0);
    expect(await healthcheck({ lastProgress: Date.now() })).toBe(0);
    expect(await healthcheck({ lastSuccess: Date.now() - 3_600_000 })).toBe(1);
    expect(await healthcheck(null)).toBe(1);
});
