#!/usr/bin/env bun
/**
 * Builds the dataset the demo recording runs against.
 *
 * Pulls real images and their captions from a Hugging Face dataset through the
 * datasets-server `rows` endpoint, which hands back plain JPEG URLs -- no
 * parquet reader, no Python, no `datasets` install.
 *
 * The upstream captions are descriptive prose ("Close-up of Marge Simpson
 * smiling happily, with her left hand raised, showcasing her tall blue hair"),
 * and this tool's headline mode is comma-separated tags, so captions are
 * reduced to tags through the keyword table below. Nothing is invented: a tag
 * is written only when the real caption says so.
 *
 * A slice of the dataset is then left untagged or half-tagged on purpose. That
 * is what a folder mid-captioning actually looks like, and it is what gives the
 * list's red/yellow/green counts something to say.
 *
 * Everything is deterministic -- fixed dataset, fixed shuffle seed -- because
 * docs/demo.tape presses a fixed number of arrow keys and expects to land on a
 * particular image. Changing DEMO_SEED or DEMO_COUNT reshuffles the list and
 * will desync the tape.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DATASET = process.env.DEMO_DATASET ?? "macadeliccc/simpsons-images";
const CONFIG = process.env.DEMO_CONFIG ?? "default";
const SPLIT = process.env.DEMO_SPLIT ?? "train";
const COUNT = Number(process.env.DEMO_COUNT ?? 120);
const SEED = Number(process.env.DEMO_SEED ?? 20260905);
const OUT_DIR = process.env.DEMO_OUT ?? ".demo/source";
const PREFIX = process.env.DEMO_PREFIX ?? "simpsons";

/** datasets-server caps a single rows request at 100. */
const PAGE = 100;

/**
 * Caption text -> tag, in the order they should appear in a caption. Order
 * matters twice over: it is the order tags are written in, and the leading
 * entries are what a trimmed (yellow) caption keeps.
 */
const TAG_RULES: Array<[string, RegExp]> = [
  // Who
  ["bart", /\bbart\b/],
  ["homer", /\bhomer\b/],
  ["marge", /\bmarge\b/],
  ["lisa", /\blisa\b/],
  ["maggie", /\bmaggie\b/],
  ["grampa", /\bgrampa\b|\bgrandpa\b|\babe simpson\b/],
  ["moe", /\bmoe\b/],
  ["krusty", /\bkrusty\b|\bclown\b/],
  ["ned flanders", /\bflanders\b|\bned\b/],
  ["mr burns", /\bburns\b/],
  ["smithers", /\bsmithers\b/],
  ["milhouse", /\bmilhouse\b/],
  ["nelson", /\bnelson\b/],
  ["ralph", /\bralph\b/],
  ["apu", /\bapu\b/],
  ["barney", /\bbarney\b/],
  ["otto", /\botto\b/],
  ["skinner", /\bskinner\b/],
  ["chief wiggum", /\bwiggum\b/],
  ["sideshow bob", /\bsideshow bob\b/],
  ["family", /\bfamily\b/],
  ["group shot", /\bgroup\b|\bcrowd\b|\bcharacters\b|\btogether\b|\bothers\b/],

  // Framing
  ["portrait", /\bclose[- ]?up\b|\bheadshot\b|\bportrait\b/],
  ["full body", /\bfull[- ]body\b|\bhead to toe\b/],

  // Pose and action
  ["standing", /\bstanding\b|\bstands\b|\bstance\b|\bupright\b/],
  ["sitting", /\bsitting\b|\bseated\b|\bsits\b|\bperched\b/],
  ["walking", /\bwalking\b|\bstrolling\b|\bstriding\b/],
  ["running", /\brunning\b|\bsprinting\b|\bdashing\b|\bfleeing\b/],
  ["lying down", /\blying\b|\blaying\b|\bon the ground\b|\bsprawled\b/],
  ["leaning", /\bleaning\b|\bslouch/],
  ["jumping", /\bjump/],
  ["dancing", /\bdancing\b/],
  ["eating", /\beating\b|\bchewing\b|\bbiting\b|\bdevouring\b/],
  ["drinking", /\bdrinking\b|\bsipping\b/],
  ["reading", /\breading\b/],
  ["writing", /\bwriting\b|\bpen in hand\b|\bpencil\b/],
  [
    "talking",
    /\btalking\b|\bspeaking\b|\bshouting\b|\byelling\b|\bmouth open\b/,
  ],
  ["pointing", /\bpointing\b/],
  ["arms raised", /\barms? (up|raised)\b|\bhand raised\b/],
  ["hands in pockets", /\bhands? in (his|her|their) pockets?\b/],

  // Expression and mood
  [
    "smiling",
    /\bsmiling\b|\bsmile\b|\bgrinning\b|\bgrin\b|\bhappily\b|\bhappy\b/,
  ],
  ["laughing", /\blaughing\b|\blaughter\b|\bgiggl/],
  [
    "angry",
    /\bangry\b|\banger\b|\bfurious\b|\bscowl|\bclenching\b|\benraged\b/,
  ],
  ["sad", /\bsad\b|\bsorrow\b|\bcrying\b|\bteary\b|\bdespair\b|\bglum\b/],
  ["surprised", /\bsurprised\b|\bshocked\b|\bastonish|\bwide[- ]eyed\b/],
  ["scared", /\bscared\b|\bafraid\b|\bfright|\bterrified\b/],
  ["playful", /\bplayful\b|\bmischiev|\bcheeky\b|\btongue out\b/],
  ["serious", /\bserious\b|\bstern\b|\bdignified\b|\bsolemn\b|\bprofound\b/],
  [
    "thinking",
    /\bthinking\b|\bthoughtful\b|\breflective\b|\bpondering\b|\blost in\b|\bconcentrat/,
  ],
  ["confident", /\bconfident\b|\bproud\b|\bhand on (his|her|their) hip\b/],
  ["relaxed", /\brelaxed\b|\bcasual\b|\bcalm\b|\bat ease\b/],

  // Where
  ["living room", /\bliving room\b|\bcouch\b|\bsofa\b/],
  ["kitchen", /\bkitchen\b|\bdining\b/],
  ["bedroom", /\bbedroom\b|\bbed\b/],
  ["bathroom", /\bbathroom\b|\bbathtub\b/],
  ["moes tavern", /\btavern\b|\bbar\b|\bbartop\b|\bbarstool\b/],
  [
    "school",
    /\bschool\b|\bclassroom\b|\bchalkboard\b|\bdetention\b|\bdesk at school\b/,
  ],
  ["office", /\boffice\b|\bcubicle\b|\bworkplace\b/],
  ["power plant", /\bpower plant\b|\bnuclear\b|\bcontrol room\b/],
  ["church", /\bchurch\b|\bpew\b/],
  ["kwik-e-mart", /\bkwik[- ]?e[- ]?mart\b|\bconvenience store\b/],
  ["house exterior", /\bhouse\b|\bhome exterior\b|\bfront lawn\b|\bdriveway\b/],
  [
    "outdoors",
    /\boutdoors?\b|\bstreet\b|\bsidewalk\b|\bpark\b|\byard\b|\bgrass\b|\bsky\b|\bfield\b/,
  ],
  ["indoors", /\bindoors?\b|\binside\b|\broom\b/],
  ["car", /\bcar\b|\bdriving\b|\bvehicle\b|\bsteering wheel\b/],
  ["water", /\bwater\b|\bpool\b|\blake\b|\briver\b|\bocean\b|\bbeach\b/],

  // Time of day
  ["night", /\bnight\b|\bnighttime\b|\bdark\b|\bmoonlit\b/],
  ["sunset", /\bsunset\b|\bdusk\b|\bgolden hour\b/],
  ["daytime", /\bdaytime\b|\bdaylight\b|\bduring the day\b|\bsunny\b/],

  // Props
  ["skateboard", /\bskateboard\b/],
  ["slingshot", /\bslingshot\b/],
  ["spray paint", /\bspray paint\b|\bgraffiti\b/],
  ["microphone", /\bmicrophone\b|\bmic\b/],
  ["saxophone", /\bsaxophone\b|\bsax\b/],
  ["guitar", /\bguitar\b/],
  ["donut", /\bdonut\b|\bdoughnut\b/],
  ["beer", /\bbeer\b|\bduff\b/],
  ["book", /\bbook\b/],
  ["paperwork", /\bpaperwork\b|\bpapers?\b|\bdocument/],
  ["television", /\btv\b|\btelevision\b/],
  ["phone", /\bphone\b/],
  ["pacifier", /\bpacifier\b|\bcork\b/],
  ["glasses", /\bglasses\b|\bspectacles\b/],
  ["hat", /\bhat\b|\bcap\b|\bfez\b/],
  ["slippers", /\bslippers\b/],
  ["suit", /\bsuit\b|\bnecktie\b|\btie\b/],
  ["dress", /\bdress\b|\bgown\b/],
  ["blue shirt", /\bblue shirt\b/],
  ["red sweatshirt", /\bred (sweatshirt|shirt|sweater)\b/],
  ["blue hair", /\bblue hair\b/],
];

/** Named characters, for deciding whether a frame reads as a portrait. */
const CHARACTERS = new Set([
  "bart",
  "homer",
  "marge",
  "lisa",
  "maggie",
  "grampa",
  "moe",
  "krusty",
  "ned flanders",
  "mr burns",
  "smithers",
  "milhouse",
  "nelson",
  "ralph",
  "apu",
  "barney",
  "otto",
  "skinner",
  "chief wiggum",
  "sideshow bob",
]);

/** On every captioned image, the way a training set carries a trigger word. */
const BASE_TAGS = ["simpsons", "cartoon"];

function tagsFor(caption: string): string[] {
  const text = caption.toLowerCase();
  const found = TAG_RULES.filter(([, re]) => re.test(text)).map(([tag]) => tag);

  const named = found.filter((t) => CHARACTERS.has(t));
  const crowded = found.includes("group shot") || found.includes("family");
  // One character and nobody else in the caption reads as a portrait.
  const shot = named.length === 1 && !crowded ? ["portrait"] : [];

  return [...new Set([...BASE_TAGS, ...found, ...shot])];
}

/** mulberry32 -- small, seeded, and stable across runtimes. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

type Row = { caption: string; url: string };

/** Every row in the split. The set is small; captions are cheap, images are not. */
async function fetchAllRows(): Promise<Row[]> {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const url =
      `https://datasets-server.huggingface.co/rows` +
      `?dataset=${encodeURIComponent(DATASET)}` +
      `&config=${encodeURIComponent(CONFIG)}` +
      `&split=${encodeURIComponent(SPLIT)}` +
      `&offset=${offset}&length=${PAGE}`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `rows request failed (${res.status}): ${await res.text()}`,
      );
    }
    const body = (await res.json()) as {
      rows: Array<{ row: Record<string, unknown> }>;
    };
    if (body.rows.length === 0) return rows;

    for (const { row } of body.rows) {
      const image = row.image as { src?: string } | undefined;
      if (!image?.src) continue;
      rows.push({
        caption: String(row.text ?? row.caption ?? ""),
        url: image.src,
      });
    }
    if (body.rows.length < PAGE) return rows;
  }
}

async function main() {
  console.log(`Listing ${DATASET} (${SPLIT}) ...`);
  const all = await fetchAllRows();
  if (all.length === 0)
    throw new Error("no rows returned; is the dataset id right?");

  // The source is grouped by character, which would put 40 Bart frames on the
  // first screen. Shuffle so a screenful looks like a real mixed dataset.
  const random = rng(SEED);
  const picked = shuffled(all, random).slice(0, COUNT);
  console.log(`Downloading ${picked.length} of ${all.length} images ...`);

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const counts = { untagged: 0, partial: 0, full: 0 };
  const vocab = new Set<string>();

  for (const [i, row] of picked.entries()) {
    const stem = `${PREFIX}_${String(i + 1).padStart(4, "0")}`;

    const res = await fetch(row.url);
    if (!res.ok) throw new Error(`image ${i} failed (${res.status})`);
    await writeFile(
      join(OUT_DIR, `${stem}.jpg`),
      Buffer.from(await res.arrayBuffer()),
    );

    const all = tagsFor(row.caption);
    for (const t of all) vocab.add(t);

    // Draw once per image for done / half-done / untouched, so the three states
    // scatter through the list instead of striping it.
    const draw = random();
    let tags: string[];
    if (draw < 0.18) {
      tags = [];
      counts.untagged++;
    } else if (draw < 0.4) {
      tags = all.slice(0, 1 + Math.floor(random() * 3));
      counts.partial++;
    } else {
      tags = all;
      counts.full++;
    }

    await writeFile(join(OUT_DIR, `${stem}.txt`), tags.join(", "));
    if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${picked.length}`);
  }

  console.log(
    `\n${picked.length} images -> ${OUT_DIR}\n` +
      `  untagged (red)    ${counts.untagged}\n` +
      `  1-3 tags (yellow) ${counts.partial}\n` +
      `  4+ tags (green)   ${counts.full}\n` +
      `  vocabulary        ${vocab.size} distinct tags\n` +
      `\nSource: https://huggingface.co/datasets/${DATASET}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
