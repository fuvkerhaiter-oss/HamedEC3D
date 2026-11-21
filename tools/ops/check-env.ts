/** npm run check:env — production config check (names only, never values). Exit 1 on errors. */
import { checkProductionConfig } from "../../src/lib/config-check";

const issues = checkProductionConfig(process.env);
for (const i of issues) console.log(`${i.level === "error" ? "ERROR" : "warn "}  ${i.key}: ${i.problem}`);
console.log(issues.some((i) => i.level === "error") ? "\nNot ready for production." : "\nNo blocking configuration problems.");
process.exitCode = issues.some((i) => i.level === "error") ? 1 : 0;
