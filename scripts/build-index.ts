import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Liquid } from "liquidjs";

interface Pledge {
  author: string;
  url: string;
  createdAt: string;
  tokens: number;
  things: string | null;
  website: string | null;
}

interface GitHubComment {
  body: string | null;
  html_url: string;
  created_at: string;
  user: { login: string } | null;
}

const REPO = process.env.GITHUB_REPOSITORY ?? "trythursday/reformed-vibe-coders";
const ISSUE = process.env.PLEDGE_ISSUE ?? "2";
const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
const ENDPOINT =
  process.env.PLEDGE_ENDPOINT ??
  "https://reformed-vibe-coders.me-5db.workers.dev/api/pledge";
const OUT = process.env.OUT_DIR ?? ".";
const PER_PAGE = 50;
const ON_ROOT = 10;

const engine = new Liquid({
  root: new URL("../templates", import.meta.url).pathname,
  extname: ".liquid",
  outputEscape: "escape",
});

const PLEDGE_LINES: string[] = [
  "I will not add more slop to the world.",
  "I will use AI to build things for people, not merely to generate more software.",
  "I will spend complexity where it is necessary, and resist it where it isn't.",
  "I will treat generated code as something I am responsible for,",
  "not something I can blame on the machine.",
  "I will remember that the goal is to solve a problem, not to produce code.",
];

function parseTokens(budget: string | null): number | null {
  if (!budget) return null;

  const suffix = budget.match(/([\d.,]+)\s*([BM])\b/i);
  if (suffix) {
    const amount = Number(suffix[1].replaceAll(",", ""));
    if (!Number.isFinite(amount)) return null;

    return Math.round(amount * (suffix[2].toUpperCase() === "B" ? 1e9 : 1e6));
  }

  const plain = budget.match(/([\d,]+)\s*tokens?/i);
  if (plain) return Number(plain[1].replaceAll(",", ""));

  const numeric = budget.match(/^([\d.,]+)/);
  if (numeric) return Number(numeric[1].replaceAll(",", ""));

  return null;
}

function parse(
  body: string,
): Pick<Pledge, "tokens" | "things" | "website"> | null {
  let section: string | null = null;
  let budget: string | null = null;
  let website: string | null = null;
  const things: string[] = [];

  for (const line of body.split("\n")) {
    const heading = line.match(/^#{1,6}\s+(.*)$/);

    if (heading) {
      section = heading[1].trim().toLowerCase();
      continue;
    }

    if (section === "monthly token pledge" && !budget && line.trim()) {
      budget = line.trim();
      continue;
    }

    if (section === "things i would like to build") things.push(line);
    if (section === "website, linkedin, or twitter" && !website && line.trim()) {
      website = line.trim();
    }
  }

  const marker = body.match(/data-tokens="(\d+)"/);
  const tokens = marker ? Number(marker[1]) : parseTokens(budget);

  if (!tokens) return null;

  return {
    tokens,
    things: things.join("\n").trim() || null,
    website,
  };
}

const formatTokens = (tokens: number): string => {
  if (tokens % 1_000_000 === 0) {
    return tokens >= 1_000_000_000
      ? `${tokens / 1_000_000_000}B`
      : `${tokens / 1_000_000}M`;
  }

  return tokens.toLocaleString("en-US");
};

async function fetchPledges(): Promise<Pledge[]> {
  const pledges: Pledge[] = [];

  for (let page = 1; page <= 200; page++) {
    const response = await fetch(
      `https://api.github.com/repos/${REPO}/issues/${ISSUE}/comments?per_page=100&page=${page}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
          "user-agent": "reformed-vibe-coders-index",
        },
      },
    );

    if (!response.ok) {
      throw new Error(
        `GitHub returned ${response.status} for page ${page}: ${await response.text()}`,
      );
    }

    const comments = (await response.json()) as GitHubComment[];

    for (const comment of comments) {
      const parsed = parse(comment.body ?? "");
      if (!parsed) continue;

      pledges.push({
        author: comment.user?.login ?? "ghost",
        url: comment.html_url,
        createdAt: comment.created_at,
        ...parsed,
      });
    }

    if (comments.length < 100) break;
  }

  pledges.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return pledges;
}

const view = (pledge: Pledge) => ({
  author: pledge.author,
  website: pledge.website,
  url: pledge.url,
  date: pledge.createdAt.slice(0, 10),
  tokensLabel: formatTokens(pledge.tokens),
});

const dir = (page: number): string => `${String(page).padStart(4, "0")}/`;

const render = (data: Record<string, unknown>): Promise<string> =>
  engine.renderFile("page", {
    repo: REPO,
    endpoint: ENDPOINT,
    pledgeLines: PLEDGE_LINES,
    ...data,
  });

const pledges = await fetchPledges();
const pages = Math.max(1, Math.ceil(pledges.length / PER_PAGE));
const coders = new Set(pledges.map((pledge) => pledge.author)).size;

mkdirSync(OUT, { recursive: true });

if (existsSync(OUT)) {
  for (const name of readdirSync(OUT)) {
    if (/^\d{4}$/.test(name)) rmSync(join(OUT, name), { recursive: true });
  }
}

writeFileSync(
  join(OUT, "index.html"),
  await render({
    title: "Have You Considered Building Less?",
    prefix: "",
    form: true,
    heading: "Recent pledges",
    pledgeNow: false,
    coders,
    seeAll: true,
    pledges: pledges.slice(0, ON_ROOT).map(view),
    newer: null,
    older: pledges.length > ON_ROOT ? dir(0) : null,
  }),
);

for (let index = 0; index < pages; index++) {
  const path = join(OUT, dir(index));

  mkdirSync(path, { recursive: true });
  writeFileSync(
    join(path, "index.html"),
    await render({
      title: `Pledges, page ${index + 1}`,
      prefix: "../",
      form: false,
      heading: `Pledges - Page ${index + 1}`,
      pledgeNow: true,
      coders,
      seeAll: false,
      pledges: pledges.slice(index * PER_PAGE, (index + 1) * PER_PAGE).map(view),
      newer: index > 0 ? `../${dir(index - 1)}` : null,
      older: index < pages - 1 ? `../${dir(index + 1)}` : null,
    }),
  );
}

console.log(
  `read ${pledges.length} pledges from ${REPO}#${ISSUE}, wrote ${pages} page(s)`,
);
