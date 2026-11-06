import { writeFileSync } from "node:fs";
import { guide } from "../app/help/guide.ts";
const lines = ["# AgentCollaboration user guide", "", "Learn how to join a team, coordinate agents, review work, and recover connections. The same content is available at `/help` on deployments that include the user guide.", "", "[README](../README.md) · [Mac setup flowchart](teammate-setup.md) · [Development](development.md)", "", "## Contents", ""];
for (const section of guide) lines.push(`- [${section.title}](#${section.id})`);
for (const section of guide) {
  lines.push("", `<a id="${section.id}"></a>`, "", `## ${section.title}`, "", section.intro, "");
  if (section.steps) lines.push(...section.steps.map((text, index) => `${index + 1}. ${text}`), "");
  if (section.bullets) lines.push(...section.bullets.map(text => `- ${text}`), "");
  if (section.table) {
    const row = cells => "| " + cells.map(cell => cell.replaceAll("|", "\\|")).join(" | ") + " |";
    lines.push(row(section.table.headers), row(section.table.headers.map(() => "---")), ...section.table.rows.map(row), "");
  }
  if (section.paragraphs) for (const text of section.paragraphs) lines.push(text, "");
  if (section.example) lines.push(`> ${section.example}`, "");
}
writeFileSync(new URL("../docs/user-guide.md", import.meta.url), lines.join("\n").trimEnd() + "\n");
console.log("Updated docs/user-guide.md from the website’s shared guide content.");
