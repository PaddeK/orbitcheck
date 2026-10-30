import { readFileSync } from "node:fs";

export interface Config {
    bookorbitUrl: string;
    bookorbitUser: string;
    bookorbitPassword: string;
    /** Where browsers reach BookOrbit, for links on the report pages; BOOKORBIT_URL may be an internal address */
    bookorbitPublicUrl: string;
    /** How BookOrbit users reach the report pages; without it no report link is stored in BookOrbit */
    reportUrl?: string;
    /** Port of the report pages */
    port: number;
    /** HTTP basic auth for the report pages, which can also download books */
    reportAuth?: { user: string; password: string };
    /** Seconds */
    checkInterval: number;
    /** Bytes; bigger EPUBs are not downloaded */
    maxFileSize: number;
    dataDir: string;
    dryRun: boolean;
    /** Offer orbitcheck's own fixes, for defects epubsana does not repair */
    orbitcheckFixes: boolean;
    /** Offer upgrading EPUB 2 books to EPUB 3 with epublift */
    epublift: boolean;
    /** The epublift program: a path, or a name looked up in PATH */
    epubliftPath: string;
    /** Allow replacing books in the library with their repaired version; needs the library mounted read-write */
    replaceInLibrary: boolean;
}

export class ConfigError extends Error {}

const MIN_CHECK_INTERVAL = 60;

/** Settings from environment variables. Every setting NAME can also be read from the file in NAME_FILE (Docker secrets). */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
    const missing: string[] = [];
    const get = (name: string, required = false): string | undefined => {
        const file = env[`${name}_FILE`];
        let value: string | undefined;
        if (file) {
            try {
                value = readFileSync(file, "utf8").trim();
            } catch (err) {
                throw new ConfigError(`Cannot read ${name}_FILE: ${(err as Error).message}`);
            }
        } else {
            value = env[name]?.trim();
        }
        if (!value && required) missing.push(name);
        return value || undefined;
    };

    const config = {
        bookorbitUrl: (get("BOOKORBIT_URL", true) ?? "").replace(/\/+$/, ""),
        bookorbitUser: get("BOOKORBIT_USER", true) ?? "",
        bookorbitPassword: get("BOOKORBIT_PASSWORD", true) ?? "",
        bookorbitPublicUrl: get("BOOKORBIT_PUBLIC_URL")?.replace(/\/+$/, "") ?? "",
        reportUrl: get("REPORT_URL")?.replace(/\/+$/, ""),
        port: parseWhole("PORT", get("PORT") ?? "8080", 1),
        reportAuth: reportAuth(get("REPORT_USER"), get("REPORT_PASSWORD")),
        checkInterval: parseWhole("CHECK_INTERVAL", get("CHECK_INTERVAL") ?? "300", MIN_CHECK_INTERVAL),
        maxFileSize: parseWhole("MAX_FILE_SIZE_MB", get("MAX_FILE_SIZE_MB") ?? "200", 1) * 1024 * 1024,
        dataDir: get("DATA_DIR") ?? "/data",
        dryRun: flag(get("DRY_RUN")),
        orbitcheckFixes: flag(get("ORBITCHECK_FIXES")),
        epublift: flag(get("EPUBLIFT")),
        epubliftPath: get("EPUBLIFT_PATH") ?? "epublift",
        replaceInLibrary: flag(get("REPLACE_IN_LIBRARY")),
    };
    if (missing.length) {
        throw new ConfigError(`Missing required settings: ${missing.join(", ")} (set them, or NAME_FILE pointing to a file with the value)`);
    }
    if (!/^https?:\/\//.test(config.bookorbitUrl)) throw new ConfigError("BOOKORBIT_URL must start with http:// or https://");
    config.bookorbitPublicUrl ||= config.bookorbitUrl;
    if (!/^https?:\/\//.test(config.bookorbitPublicUrl)) throw new ConfigError("BOOKORBIT_PUBLIC_URL must start with http:// or https://");
    if (config.reportUrl && !/^https?:\/\//.test(config.reportUrl)) throw new ConfigError("REPORT_URL must start with http:// or https://");
    return config;
}

const flag = (value: string | undefined) => ["1", "true", "yes"].includes(value?.toLowerCase() ?? "");

function reportAuth(user: string | undefined, password: string | undefined): Config["reportAuth"] {
    if (!password) {
        if (user) throw new ConfigError("REPORT_USER needs REPORT_PASSWORD");
        return undefined;
    }
    return { user: user ?? "orbitcheck", password };
}

function parseWhole(name: string, value: string, min: number): number {
    const number = Number(value);
    if (!Number.isInteger(number)) throw new ConfigError(`${name} must be a whole number, got "${value}"`);
    if (number < min) throw new ConfigError(`${name} must be at least ${min}`);
    return number;
}
