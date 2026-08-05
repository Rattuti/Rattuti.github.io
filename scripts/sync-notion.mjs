#!/usr/bin/env node
// Notion (アプリ棚 DB) -> apps.json
// Notion API version 2022-06-28. Requires NOTION_TOKEN and NOTION_DATABASE_ID env vars.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const NOTION_VERSION = "2022-06-28";
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.NOTION_DATABASE_ID;
const GH_USER = process.env.GITHUB_REPOSITORY_OWNER || "Rattuti";

const OUT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "apps.json"
);

if (!NOTION_TOKEN) {
  console.error("NOTION_TOKEN environment variable is not set.");
  process.exit(1);
}

function plainText(richTextArray) {
  if (!Array.isArray(richTextArray)) return "";
  return richTextArray.map((t) => t.plain_text || "").join("");
}

function readProperty(props, name) {
  const prop = props[name];
  if (!prop) return null;
  switch (prop.type) {
    case "title":
      return plainText(prop.title);
    case "rich_text":
      return plainText(prop.rich_text);
    case "select":
      return prop.select ? prop.select.name : "";
    case "number":
      return typeof prop.number === "number" ? prop.number : null;
    case "url":
      return prop.url || "";
    default:
      return null;
  }
}

async function queryDatabase() {
  const results = [];
  let cursor;

  do {
    const res = await fetch(
      `https://api.notion.com/v1/databases/${DATABASE_ID}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(cursor ? { start_cursor: cursor } : {})
      }
    );

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Notion API error ${res.status}: ${body}`);
    }

    const data = await res.json();
    results.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return results;
}

function buildUrl(repo) {
  if (!repo) return "";
  return `https://${GH_USER.toLowerCase()}.github.io/${repo}/`;
}

function toApp(page) {
  const props = page.properties;
  const repo = readProperty(props, "リポジトリ") || "";
  const status = readProperty(props, "状態") || "";
  const url = status === "公開中" ? (readProperty(props, "URL") || buildUrl(repo)) : "";

  return {
    名前: readProperty(props, "名前") || "",
    状態: status,
    リポジトリ: repo,
    URL: url,
    NotionURL: page.url || "",
    カテゴリ: readProperty(props, "カテゴリ") || "",
    説明: readProperty(props, "説明") || "",
    表示順: readProperty(props, "表示順")
  };
}

async function main() {
  const pages = await queryDatabase();
  const apps = pages
    .filter((page) => !page.archived)
    .map(toApp)
    .filter((app) => app.名前)
    .sort((a, b) => {
      const oa = typeof a.表示順 === "number" ? a.表示順 : Infinity;
      const ob = typeof b.表示順 === "number" ? b.表示順 : Infinity;
      if (oa !== ob) return oa - ob;
      return a.名前.localeCompare(b.名前, "ja");
    });

  const output = {
    updated: new Date().toISOString(),
    apps
  };

  await writeFile(OUT_PATH, JSON.stringify(output, null, 2) + "\n", "utf-8");
  console.log(`Wrote ${apps.length} apps to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
