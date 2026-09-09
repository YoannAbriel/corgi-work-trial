// Full-page screenshot of a production page with a role's cookie. Read-only: navigation only.
//   node shot.mjs <email> <path> <out.png> [width]
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const OTHER = "/private/tmp/claude-501/-Users-yoannabriel-dev-corgi-work-trial/7f4f9bd0-078b-4957-aadb-2bb708b7ef69/scratchpad/node_modules";
const require = createRequire(join(OTHER, "x.js"));
const { chromium } = require("playwright-core");
const BASE = "https://corgi-work-trial-iota.vercel.app";
const HERE = dirname(new URL(import.meta.url).pathname);
const [email, path, out, widthText] = process.argv.slice(2);
const executablePath =
  process.env.CHROME_PATH ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1208/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const cookie = readFileSync(join(HERE, "cookies", email.replace(/[^a-z0-9@.]/gi, "_")), "utf8").split("=")[1];
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: Number(widthText ?? 1440), height: 900 }, deviceScaleFactor: 1 });
await context.addCookies([{ name: "corgi_session", value: cookie, domain: "corgi-work-trial-iota.vercel.app", path: "/", httpOnly: true, secure: true, sameSite: "Lax" }]);
const page = await context.newPage();
const response = await page.goto(`${BASE}${path}`, { waitUntil: process.env.WAIT ?? "networkidle" });
await page.screenshot({ path: out, fullPage: true });
console.log(`shot ${path} as ${email}: ${response?.status()} -> ${out}`);
await browser.close();
