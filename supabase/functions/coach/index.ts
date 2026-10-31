// Crucible AI coach: a Supabase Edge Function, so the Anthropic API key stays on the server.
//
// POST { action: "coach", question, today, targets }   -> { answer, remaining }
// POST { action: "food", text?, image?, today }         -> { items, note, remaining }
//
// Reads the signed-in person's data with their own login, so the database rules
// (crew-only, owner-only) apply here exactly as they do in the app.

import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@1.3.0/helpers/zod";
import { z } from "npm:zod@4.1.12";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

// Settings. Change these under Edge Functions → Secrets without touching the code.
const COACH_MODEL = Deno.env.get("COACH_MODEL") ?? "claude-opus-5-5";
const FOOD_MODEL = Deno.env.get("FOOD_MODEL") ?? "claude-haiku-5-5";
const COACH_PER_DAY = Number(Deno.env.get("COACH_PER_DAY") ?? 2);
const FOOD_PER_DAY = Number(Deno.env.get("FOOD_PER_DAY") ?? 30);

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

class UserError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? req.headers.get("apikey") ?? "";
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: { user } } = await sb.auth.getUser(token);
    if (!user) throw new UserError("Please sign in again.", 401);

    const body = await req.json();
    const today = /^\d{4}-\d{2}-\d{2}$/.test(body.today ?? "") ? body.today : new Date().toISOString().slice(0, 10);
    if (body.action === "food") return json(await estimateFood(sb, user.id, body));
    if (body.action === "coach") return json(await coach(sb, user.id, today, body));
    throw new UserError("Unknown request.");
  } catch (e) {
    console.error(e);
    if (e instanceof UserError) return json({ error: e.message }, e.status);
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "The coach isn't set up yet: the AI key is missing or wrong." }, 503);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "The coach is busy. Try again in a minute." }, 503);
    if (e instanceof Anthropic.APIError) return json({ error: "The coach is unavailable right now. If this keeps happening, this month's AI budget may be used up." }, 503);
    return json({ error: "Something went wrong. Try again." }, 500);
  }
});

// Per-person daily limits (rolling 24 hours) keep the monthly bill predictable.
async function remainingToday(sb: SupabaseClient, uid: string, kind: "coach" | "food", limit: number) {
  const { count, error } = await sb.from("ai_requests").select("id", { count: "exact", head: true })
    .eq("user_id", uid).eq("kind", kind).gte("created_at", new Date(Date.now() - 864e5).toISOString());
  if (error) throw error;
  return limit - (count ?? 0);
}

async function record(sb: SupabaseClient, kind: "coach" | "food", question: string, answer: string) {
  const { error } = await sb.from("ai_requests").insert({ kind, question: question.slice(0, 2000), answer: answer.slice(0, 20000) });
  if (error) console.error(error);
}

/* ── Food estimates ── */

const FoodEstimate = z.object({
  items: z.array(z.object({
    name: z.string(),
    portion: z.string(),
    calories: z.number(),
    protein: z.number(),
    carbs: z.number(),
    fat: z.number(),
  })),
  note: z.string(),
});

async function estimateFood(sb: SupabaseClient, uid: string, body: { text?: string; image?: string }) {
  const text = String(body.text ?? "").slice(0, 500).trim();
  const image = typeof body.image === "string" && body.image.length < 4_000_000 ? body.image : null;
  if (!text && !image) throw new UserError("Describe the meal or add a photo.");
  const left = await remainingToday(sb, uid, "food", FOOD_PER_DAY);
  if (left <= 0) throw new UserError(`You've used today's ${FOOD_PER_DAY} meal estimates. Enter the numbers by hand, or try again tomorrow.`, 429);

  const content: Anthropic.ContentBlockParam[] = [];
  if (image) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } });
  content.push({ type: "text", text: text ? `Meal: ${text}` : "Estimate the meal in this photo." });

  const res = await anthropic.messages.parse({
    model: FOOD_MODEL,
    max_tokens: 4000,
    system: "You estimate calories and macros (grams of protein, carbs, fat) for meals people log in a fitness app. " +
      "List each food separately with the portion you assumed. Use the stated amounts; otherwise assume typical US portions. " +
      "For chain restaurants use their published nutrition when you know it. Round calories to the nearest 5 and grams to whole numbers. " +
      "In `note`, say in one short sentence what you assumed (portion sizes, cooking oil, sauces). " +
      "If there's no food in the photo or the text isn't a meal, return no items and say so in `note`.",
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(FoodEstimate), effort: "low" },
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) throw new UserError("Couldn't estimate that one. Try describing it differently.");
  await record(sb, "food", text || "(photo)", JSON.stringify(res.parsed_output));
  return { ...res.parsed_output, remaining: left - 1 };
}

/* ── Coach ── */

const COACH_SYSTEM = `You are Crucible Coach, the strength and nutrition coach inside Crucible, an app a small crew of friends uses to follow the same training program, even on days they can't lift together.

Each message gives you one crew member's data (profile, maxes and PR history, goals, body weight, the crew's workout schedule, their logged workouts, nutrition targets and food logs, recovery check-ins) followed by their question.

How to coach:
- Ground every point in their numbers. Quote the actual figures and dates. If something you'd need hasn't been logged, say what to log instead of guessing.
- Goals with a target date: say whether they're ahead, on track or behind, using the projection in the data (their recent rate of progress), and what would close the gap.
- Workout suggestions: start from the crew's scheduled workout for the day when there is one, and use their recent exercises and weights to give specific sets, reps and target weights in lb. Progress conservatively: about +5 lb on upper-body lifts and +10 lb on lower-body lifts after all reps were completed; hold or reduce after missed reps.
- Staying on schedule: compare the workouts they've logged with the crew's scheduled days and call out missed sessions plainly but encouragingly.
- Nutrition: compare recent daily averages with their targets, especially protein, and suggest practical foods or swaps.
- Recovery: with under 7 hours of sleep or soreness of 4–5 out of 5, scale back volume or intensity and say why.
- Safety: you are not a doctor. For pain, injury or medical conditions, suggest seeing a professional. Never suggest eating under 1,500 kcal a day for men or 1,200 for women, or losing more than about 1% of body weight a week.

Style: talk to them directly, like a good coach texting a client — direct, specific, encouraging. Keep it under 250 words unless they ask for more. Use short ### headings and "- " bullet points with **bold** for key numbers. No tables.`;

const day = (s: string, n: number) => {
  const d = new Date(`${s}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);

type Lift = { lift: string; value: number; recorded_on: string };

// Projection from the person's rate of progress on that lift over the last ~6 months.
function project(entries: Lift[], target: number, today: string) {
  const recent = entries.filter((e) => e.recorded_on >= day(today, -180));
  if (!recent.length) return "no recent entries";
  const best = recent.reduce((a, b) => (b.value > a.value ? b : a));
  if (best.value >= target) return `reached (best ${best.value})`;
  const first = recent[0];
  const span = daysBetween(first.recorded_on, best.recorded_on);
  if (span < 14 || best.value <= first.value) return `current best ${best.value}; not enough progress logged to project`;
  const perWeek = (best.value - first.value) / span * 7;
  const eta = day(best.recorded_on, Math.ceil((target - best.value) / perWeek * 7));
  return `current best ${best.value} on ${best.recorded_on}; gaining ~${perWeek.toFixed(1)}/week; projected to reach ${target} around ${eta}`;
}

async function coach(sb: SupabaseClient, uid: string, today: string, body: { question?: string; targets?: unknown }) {
  const question = String(body.question ?? "").slice(0, 1000).trim() || "How am I doing overall, and what should I focus on this week?";
  const left = await remainingToday(sb, uid, "coach", COACH_PER_DAY);
  if (left <= 0) throw new UserError(`You've used today's ${COACH_PER_DAY} coach questions. Check back tomorrow.`, 429);

  // Query rows are shaped by the select strings below; they're typed where they're used.
  // deno-lint-ignore no-explicit-any
  const q = async (p: PromiseLike<{ data: unknown; error: unknown }>): Promise<any> => {
    const { data, error } = await p;
    if (error) throw error;
    return data;
  };
  const since = (n: number) => day(today, -n);
  const [profile, lifts, weighins, goals, ngoal, food, recovery, posts, events, history] = await Promise.all([
    q(sb.from("profiles").select("display_name, height_in").eq("id", uid).single()),
    q(sb.from("lift_entries").select("lift, value, recorded_on").eq("user_id", uid).order("recorded_on")),
    q(sb.from("weigh_ins").select("weight_lbs, recorded_on").eq("user_id", uid).gte("recorded_on", since(120)).order("recorded_on")),
    q(sb.from("goals").select("kind, lift, target, body, target_date, done").eq("user_id", uid)),
    q(sb.from("nutrition_goals").select("*").eq("user_id", uid).maybeSingle()),
    q(sb.from("food_logs").select("eaten_on, meal, name, calories, protein, carbs, fat").eq("user_id", uid).gte("eaten_on", since(14)).order("eaten_on")),
    q(sb.from("recovery_logs").select("logged_on, sleep_hours, soreness, energy").eq("user_id", uid).gte("logged_on", since(14)).order("logged_on")),
    q(sb.from("posts").select("created_at, body, exercises, events(title)").eq("user_id", uid).gte("created_at", `${since(30)}T00:00:00Z`).order("created_at")),
    q(sb.from("events").select("event_date, start_time, title, kind, details").gte("event_date", since(14)).lte("event_date", day(today, 7)).order("event_date")),
    q(sb.from("ai_requests").select("question, answer, created_at").eq("user_id", uid).eq("kind", "coach").order("created_at", { ascending: false }).limit(2)),
  ]);

  const liftList = lifts as Lift[];
  const goalLines = (goals as { kind: string; lift: string | null; target: number | null; body: string | null; target_date: string | null; done: boolean }[]).map((g) => {
    if (g.kind === "lift" && g.lift && g.target) {
      return `- ${g.lift} ${g.target}${g.lift === "pullup" ? " reps" : " lb"}${g.target_date ? ` by ${g.target_date}` : ""}${g.done ? " (marked done)" : ""}: ${project(liftList.filter((l) => l.lift === g.lift), g.target, today)}`;
    }
    if (g.kind === "weight") return `- Body weight ${g.target} lb${g.target_date ? ` by ${g.target_date}` : ""}${g.done ? " (marked done)" : ""}`;
    return `- ${g.body}${g.target_date ? ` (by ${g.target_date})` : ""}${g.done ? " (marked done)" : ""}`;
  });

  const foodByDay = new Map<string, { calories: number; protein: number; carbs: number; fat: number; items: string[] }>();
  for (const f of food as { eaten_on: string; name: string; calories: number; protein: number; carbs: number; fat: number }[]) {
    const t = foodByDay.get(f.eaten_on) ?? { calories: 0, protein: 0, carbs: 0, fat: 0, items: [] };
    t.calories += f.calories; t.protein += +f.protein; t.carbs += +f.carbs; t.fat += +f.fat; t.items.push(f.name);
    foodByDay.set(f.eaten_on, t);
  }

  const data = [
    `Today is ${today}. Name: ${(profile as { display_name: string }).display_name}. Height: ${(profile as { height_in: number | null }).height_in ?? "not set"} in.`,
    `\n## Lift history (lb; pull-ups are reps)\n${liftList.map((l) => `${l.recorded_on} ${l.lift} ${l.value}`).join("\n") || "none logged"}`,
    `\n## Goals\n${goalLines.join("\n") || "none set"}`,
    `\n## Weigh-ins (last 120 days)\n${(weighins as { recorded_on: string; weight_lbs: number }[]).map((w) => `${w.recorded_on} ${w.weight_lbs} lb`).join("\n") || "none"}`,
    `\n## Nutrition settings\n${ngoal ? JSON.stringify(ngoal) : "not set"}\nDaily targets shown in the app: ${body.targets ? JSON.stringify(body.targets) : "not set"}`,
    `\n## Food log by day (last 14 days)\n${[...foodByDay].map(([d, t]) => `${d}: ${Math.round(t.calories)} kcal, ${Math.round(t.protein)}P/${Math.round(t.carbs)}C/${Math.round(t.fat)}F (${t.items.join("; ")})`).join("\n") || "nothing logged"}`,
    `\n## Recovery check-ins (last 14 days)\n${(recovery as { logged_on: string; sleep_hours: number | null; soreness: number | null; energy: number | null }[]).map((r) => `${r.logged_on}: sleep ${r.sleep_hours ?? "?"}h, soreness ${r.soreness ?? "?"}/5, energy ${r.energy ?? "?"}/5`).join("\n") || "none"}`,
    `\n## Crew workout schedule (last 14 days and next 7)\n${(events as { event_date: string; start_time: string | null; title: string; kind: string; details: string | null }[]).map((e) => `${e.event_date}${e.start_time ? ` ${e.start_time.slice(0, 5)}` : ""} [${e.kind}] ${e.title}${e.details ? `: ${e.details.replace(/\n/g, "; ")}` : ""}`).join("\n") || "nothing scheduled"}`,
    `\n## Their logged workouts (last 30 days)\n${(posts as { created_at: string; body: string; exercises: { name: string; sets?: number; reps?: number | string; weight?: number }[]; events: { title: string } | null }[]).map((p) => `${p.created_at.slice(0, 10)}${p.events ? ` (${p.events.title})` : ""}: ${p.exercises.map((x) => `${x.name} ${x.sets ?? "?"}x${x.reps ?? "?"}${x.weight ? ` @ ${x.weight}` : ""}`).join(", ")}${p.body ? ` — "${p.body.replace(/\n/g, " ")}"` : ""}`).join("\n") || "none logged"}`,
    `\n## Your last answers to them (for continuity)\n${(history as { question: string; answer: string; created_at: string }[]).map((h) => `${h.created_at.slice(0, 10)} Q: ${h.question}\nA: ${h.answer.slice(0, 1200)}`).join("\n\n") || "none"}`,
  ].join("\n");

  const res = await anthropic.beta.messages.create({
    model: COACH_MODEL,
    max_tokens: 8000,
    output_config: { effort: "medium" },
    // Haiku has no server-side fallback; the others retry a declined request on another model.
    ...(COACH_MODEL.includes("haiku") ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
    system: COACH_SYSTEM,
    messages: [{ role: "user", content: `<member_data>\n${data}\n</member_data>\n\nQuestion: ${question}` }],
  });
  if (res.stop_reason === "refusal") throw new UserError("The coach couldn't answer that one. Try asking another way.");
  const answer = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
  if (!answer) throw new UserError("The coach didn't have an answer. Try again.");
  await record(sb, "coach", question, answer);
  return { answer, remaining: left - 1 };
}
