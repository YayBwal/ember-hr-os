// Server-only helpers for ingesting Telegram-submitted CVs:
// - download from the candidate-cvs bucket via service-role
// - run Gemini PDF extraction + role scoring (no pdf-parse needed)
// - update the candidates row with the parsed fields
import { createClient } from "@supabase/supabase-js";

const PARSE_PROMPT = `You are an expert technical recruiter. Read this candidate's CV (PDF) submitted via Telegram for the role: "{ROLE}".

Return STRICT JSON (no prose, no markdown fences):
{
  "full_name": string,
  "email": string | null,
  "skills": string[],            // 5-12 most relevant skills
  "ai_match_score": number,      // 0-100 integer match for the role
  "summary": string,             // 1 sentence on the candidate
  "next_action": string          // e.g. "Schedule Technical Screening" / "Reject - insufficient experience"
}

Score honestly. If the CV is unreadable, return ai_match_score 0 and next_action "Reject - unreadable CV".`;

interface ParsedCv {
  full_name: string;
  email: string | null;
  skills: string[];
  ai_match_score: number;
  summary: string;
  next_action: string;
}

function admin() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function scoreTelegramCv(opts: {
  candidate_id: string;
  storage_path: string;
  role: string;
}): Promise<ParsedCv> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

  const sb = admin();

  // 1. Download the file from candidate-cvs bucket
  const { data: file, error: dlErr } = await sb.storage
    .from("candidate-cvs")
    .download(opts.storage_path);
  if (dlErr || !file) throw new Error(`Download failed: ${dlErr?.message ?? "no file"}`);

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length < 100) throw new Error("CV file empty");
  if (buf.length > 20 * 1024 * 1024) throw new Error("CV file too large (>20MB)");
  const base64 = buf.toString("base64");

  // 2. Send to Gemini via Lovable AI gateway as a file part
  const userPrompt = PARSE_PROMPT.replace("{ROLE}", opts.role);
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            {
              type: "file",
              file: {
                filename: opts.storage_path.split("/").pop() ?? "cv.pdf",
                file_data: `data:application/pdf;base64,${base64}`,
              },
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`AI scoring failed (${res.status}): ${t.slice(0, 200)}`);
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = json.choices?.[0]?.message?.content ?? "{}";
  let parsed: Partial<ParsedCv> = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]);
  }

  const result: ParsedCv = {
    full_name: String(parsed.full_name ?? "Telegram applicant").slice(0, 120),
    email: parsed.email ? String(parsed.email).slice(0, 200) : null,
    skills: Array.isArray(parsed.skills) ? parsed.skills.slice(0, 12).map(String) : [],
    ai_match_score: Math.max(0, Math.min(100, Math.round(Number(parsed.ai_match_score ?? 0)))),
    summary: String(parsed.summary ?? ""),
    next_action: String(parsed.next_action ?? "Schedule initial screening"),
  };

  // 3. Update the candidate row with the parsed fields
  await sb
    .from("candidates")
    .update({
      full_name: result.full_name,
      email: result.email,
      ai_match_score: result.ai_match_score,
      skills: result.skills,
      next_action: result.next_action,
      notes: result.summary,
    })
    .eq("id", opts.candidate_id);

  return result;
}
