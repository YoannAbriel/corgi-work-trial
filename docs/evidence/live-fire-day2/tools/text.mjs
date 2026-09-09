// HTML to plain text lines, for reading the fetched pages. node text.mjs <file.html>
import { readFileSync } from "node:fs";
const html = readFileSync(process.argv[2], "utf8");
const text = html
  .replace(/<script[\s\S]*?<\/script>/gi, "")
  .replace(/<style[\s\S]*?<\/style>/gi, "")
  .replace(/<svg[\s\S]*?<\/svg>/gi, "")
  .replace(/<(option)[^>]*value="([^"]*)"[^>]*>/gi, "\n[option value=$2] ")
  .replace(/<(input)[^>]*name="([^"]*)"[^>]*value="([^"]*)"[^>]*>/gi, "\n[input $2=$3]\n")
  .replace(/<a [^>]*href="([^"]*)"[^>]*>/gi, "\n[a $1] ")
  .replace(/<(br|p|div|li|tr|h[1-6]|section|article|form|table|details|summary|dt|dd|label|button)[^>]*>/gi, "\n")
  .replace(/<(td|th)[^>]*>/gi, " | ")
  .replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
  .replace(/&rsquo;/g, "'").replace(/&nbsp;/g, " ").replace(/&#8217;/g, "'").replace(/&#x2019;/g, "'")
  .split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
console.log(text.join("\n"));
