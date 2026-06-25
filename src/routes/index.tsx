import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Sparkles,
  Users,
  Workflow,
  AudioLines,
  Wallet,
  Activity,
  CheckCircle2,
  Clock,
  GitBranch,
  MessageSquare,
  Bot,
  ShieldCheck,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { formatMMKCompact } from "@/lib/format";
import logoAsset from "@/assets/mandai-logo.svg.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Mandai — AI HR Operating System for HR & Team Leaders" },
      {
        name: "description",
        content:
          "Telegram-powered recruitment, live workforce ops, meeting-to-task delivery, MMK payroll and KPI-driven bonuses — built for HR and Team Leaders.",
      },
      { property: "og:title", content: "Mandai — AI HR Operating System" },
      {
        property: "og:description",
        content:
          "Telegram CV intake, live operations, KPI calculation and MMK payroll in one role-aware workspace.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <Hero />
      <RolesSection />
      <FeatureGrid />
      <DashboardPreview />
      <Timeline />
      <CTASection />
      <Footer />
    </div>
  );
}

function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2">
          <LogoMark />
          <span className="font-display text-lg font-semibold tracking-tight">Mandai</span>
        </Link>
        <nav className="hidden items-center gap-8 text-sm text-muted-foreground md:flex">
          <a href="#roles" className="hover:text-foreground transition-colors">Roles</a>
          <a href="#pipeline" className="hover:text-foreground transition-colors">Pipeline</a>
          <a href="#operations" className="hover:text-foreground transition-colors">Operations</a>
          <a href="#financial" className="hover:text-foreground transition-colors">Financial</a>
          <a href="#feedback" className="hover:text-foreground transition-colors">Feedback</a>
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link
            to="/auth"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90"
          >
            Enter Workspace <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </header>
  );
}

function LogoMark({ className = "h-10 w-10" }: { className?: string }) {
  return (
    <img
      src={logoAsset.url}
      alt="Mandai"
      className={`${className} object-contain`}
    />
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border/60">
      <div className="absolute inset-0 grid-bg opacity-[0.35] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
      <div className="relative mx-auto max-w-7xl px-6 py-24 sm:py-32">
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
            </span>
            Built for HR & Team Leaders
          </div>
          <h1 className="mt-6 font-display text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl md:text-7xl">
            One workspace,
            <br />
            <span className="text-primary">two clear roles.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Mandai connects a Telegram bot, your hiring pipeline, live operations, meeting-driven delivery,
            KPI calculation and MMK payroll into a single AI-driven loop — with role-aware views for HR
            and Team Leaders.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/auth"
              className="group inline-flex h-12 items-center gap-2 rounded-md bg-primary px-7 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 hover:shadow-primary/30"
            >
              Enter Workspace
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <a
              href="#roles"
              className="inline-flex h-12 items-center gap-2 rounded-md border border-border bg-card px-6 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              See the loop
            </a>
          </div>
          <div className="mt-12 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-border bg-border text-left">
            <Stat label="Currency" value="MMK" />
            <Stat label="Intake" value="Telegram bot" />
            <Stat label="State" value="Real-time" />
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card p-5">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

const ROLES = [
  {
    icon: ShieldCheck,
    name: "HR",
    blurb:
      "Owns recruitment, operations oversight, payroll, KPI calculation and feedback. Sees the whole company.",
    points: [
      "Pipeline with Telegram CV intake & Talent Pool",
      "Promotions & Demotions with salary-band guardrails",
      "MMK payroll, bonuses & KPI overrides",
      "Feedback dashboard & incident reports",
    ],
  },
  {
    icon: Users,
    name: "Team Leader",
    blurb:
      "Distraction-free interface. Assigns tasks, rates completed work, and tracks team performance only.",
    points: [
      "Assign tasks to team members",
      "Review & rate completed tasks (0–100)",
      "Single performance slider per member",
      "No sidebar — just the team you own",
    ],
  },
];

function RolesSection() {
  return (
    <section id="roles" className="border-b border-border/60 bg-muted/30">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <div className="max-w-2xl">
          <div className="text-xs font-mono uppercase tracking-[0.2em] text-primary">Role-aware workspace</div>
          <h2 className="mt-3 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            HR sees the system. Team Leaders see their team.
          </h2>
          <p className="mt-4 text-base text-muted-foreground">
            Switch roles from the top of the workspace. Each role renders only the surface it needs — no
            cross-contamination, no clutter.
          </p>
        </div>
        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-2">
          {ROLES.map((r) => (
            <div key={r.name} className="bg-card p-8">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
                <r.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-6 font-display text-2xl font-semibold tracking-tight">{r.name}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{r.blurb}</p>
              <ul className="mt-6 space-y-2">
                {r.points.map((p) => (
                  <li key={p} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const FEATURES = [
  {
    id: "pipeline",
    icon: Bot,
    title: "Pipeline",
    eyebrow: "Telegram + AI intake",
    blurb:
      "Candidates apply via the Telegram bot. AI scores CVs against role requirements and routes them — duplicates by email are caught automatically.",
    points: [
      "Telegram /apply → PDF CV upload",
      "AI extraction & role matching",
      "Talent Pool & On-Hold with recall",
      "Notify candidates from the pipeline",
    ],
  },
  {
    id: "operations",
    icon: Workflow,
    title: "Operations",
    eyebrow: "Employees · Teams · Meetings",
    blurb:
      "Live employees view with attendance, department and Telegram link status. Team Leaders manage assignments inline.",
    points: [
      "Real-time employee leaderboard",
      "Team detail with tasks & reviews",
      "Mobile-first responsive cards",
      "Telegram link status per employee",
    ],
  },
  {
    id: "delivery",
    icon: AudioLines,
    title: "Delivery",
    eyebrow: "Meeting → Tasks",
    blurb:
      "Upload a meeting. AI extracts action items into a Kanban board. Completion flows back into KPI and payroll.",
    points: [
      "Audio → transcript → tasks",
      "Kanban with optimistic updates",
      "Team Leader review (0–100)",
      "Feeds KPI weighting",
    ],
  },
  {
    id: "financial",
    icon: Wallet,
    title: "Financial",
    eyebrow: "Payroll · KPI · MMK",
    blurb:
      "MMK payroll with KPI-linked bonuses. Promotions & Demotions enforce salary bands. KPI overrides are auditable.",
    points: [
      "Tasks 60% + Attendance 40% + TL rating 25%",
      "Eligibility & Bonus overrides with audit",
      "Promotions & Demotions, band-guarded",
      "Remote vs on-site bonus rules",
    ],
  },
  {
    id: "feedback",
    icon: MessageSquare,
    title: "Feedback",
    eyebrow: "Telegram surveys",
    blurb:
      "Employees link with their EMP-XXXX code and respond to surveys in Telegram. HR sees responses and incident reports.",
    points: [
      "/start → link by employee code",
      "Survey responses in one dashboard",
      "Incident reports & line items",
      "/help command for guidance",
    ],
  },
  {
    id: "assistant",
    icon: Sparkles,
    title: "AI Assistant",
    eyebrow: "Chat + Voice",
    blurb:
      "A single dock combines text copilot and Gemini Live voice. Deep data access across pipeline, ops, payroll and feedback.",
    points: [
      "Chat & voice in one dock",
      "Charts inline from real data",
      "CV analysis on demand",
      "Burmese voice input understood",
    ],
  },
];

function FeatureGrid() {
  return (
    <section className="border-b border-border/60">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <div className="max-w-2xl">
          <div className="text-xs font-mono uppercase tracking-[0.2em] text-primary">Six modules · One loop</div>
          <h2 className="mt-3 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            Every HR motion, on one canvas.
          </h2>
          <p className="mt-4 text-base text-muted-foreground">
            From Telegram CV intake to MMK payslip — Mandai is the connective tissue across recruitment,
            operations, delivery, finance and feedback.
          </p>
        </div>

        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.id} id={f.id} className="group relative bg-card p-8 transition-colors hover:bg-accent/30">
              <div className="flex items-center justify-between">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/20">
                  <f.icon className="h-5 w-5" />
                </div>
                <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                  {f.eyebrow}
                </span>
              </div>
              <h3 className="mt-6 font-display text-2xl font-semibold tracking-tight">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.blurb}</p>
              <ul className="mt-6 space-y-2">
                {f.points.map((p) => (
                  <li key={p} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function DashboardPreview() {
  return (
    <section className="relative border-b border-border/60 bg-muted/30">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <div className="mx-auto max-w-2xl text-center">
          <div className="text-xs font-mono uppercase tracking-[0.2em] text-primary">Live workspace</div>
          <h2 className="mt-3 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            A workspace that moves with the work.
          </h2>
        </div>

        <div className="mt-12 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-black/5">
          <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-4 py-2.5">
            <div className="flex gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
              <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
              <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
            </div>
            <div className="ml-2 font-mono text-[11px] text-muted-foreground">mandai.workspace / operations</div>
            <div className="ml-auto flex items-center gap-1.5 text-[11px] text-primary">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
              </span>
              AI active
            </div>
          </div>
          <div className="grid grid-cols-12 gap-px bg-border">
            <aside className="col-span-2 hidden bg-card p-4 md:block">
              <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                HR view
              </div>
              <ul className="mt-3 space-y-1 text-sm">
                {["Pipeline", "Operations", "Delivery", "Financial", "Feedbacks"].map((m, i) => (
                  <li
                    key={m}
                    className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${i === 1 ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${i === 1 ? "bg-primary" : "bg-muted-foreground/40"}`} />
                    {m}
                  </li>
                ))}
              </ul>
            </aside>
            <div className="col-span-12 bg-background p-6 md:col-span-10">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <KpiTile label="Employees" value="48" />
                <KpiTile label="Open tasks" value="23" trend />
                <KpiTile label="Payroll · Sep" value={formatMMKCompact(124_500_000)} accent />
                <KpiTile label="Avg KPI" value="88.4" />
              </div>
              <div className="mt-6 grid gap-3 md:grid-cols-4">
                {[
                  { name: "To Do", count: 6, tasks: ["Screen 10 Telegram CVs", "Refresh attendance"] },
                  { name: "In Progress", count: 4, tasks: ["Finalize Q3 payroll", "Promotion review"] },
                  { name: "Review", count: 3, tasks: ["TL ratings — Eng", "Bonus overrides"] },
                  { name: "Done", count: 10, tasks: ["Survey #4 published"] },
                ].map((col, idx) => (
                  <div key={col.name} className="rounded-lg border border-border bg-card p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        {col.name}
                      </span>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-mono ${idx === 1 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                        {col.count}
                      </span>
                    </div>
                    <div className="mt-2 space-y-2">
                      {col.tasks.map((t) => (
                        <div key={t} className="rounded border border-border bg-background p-2 text-xs">
                          {t}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function KpiTile({ label, value, trend, accent }: { label: string; value: string; trend?: boolean; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${accent ? "border-primary/30 bg-primary/5" : "border-border bg-card"}`}>
      <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
        <span>{label}</span>
        {trend && <Activity className="h-3 w-3 text-primary" />}
      </div>
      <div className={`mt-1 font-display text-xl font-semibold tracking-tight ${accent ? "text-primary" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function Timeline() {
  const items = [
    {
      icon: Clock,
      eyebrow: "Before",
      title: "Tool sprawl",
      body: "ATS, spreadsheets, chat groups and payroll exports — disconnected, lagging, and impossible to audit.",
    },
    {
      icon: Sparkles,
      eyebrow: "With Mandai",
      title: "AI loop",
      body: "Telegram intake feeds the pipeline. Tasks update KPIs. KPIs feed bonuses. Payroll recomputes — continuously.",
    },
    {
      icon: GitBranch,
      eyebrow: "Outcome",
      title: "One system",
      body: "HR steers the company. Team Leaders steer their team. Everyone reads the same live state.",
    },
  ];
  return (
    <section className="border-b border-border/60">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <div className="max-w-2xl">
          <div className="text-xs font-mono uppercase tracking-[0.2em] text-primary">The shift</div>
          <h2 className="mt-3 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            From tool sprawl to a unified HR loop.
          </h2>
        </div>
        <div className="mt-14 relative">
          <div className="absolute left-4 top-2 hidden h-[calc(100%-1rem)] w-px bg-border md:left-1/2 md:block" />
          <ol className="space-y-10">
            {items.map((it, i) => (
              <li key={it.title} className="relative grid gap-4 md:grid-cols-2 md:gap-12">
                <div className={`md:order-${i % 2 === 0 ? "1" : "2"} ${i % 2 === 0 ? "md:text-right" : ""}`}>
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-primary">
                    <it.icon className="h-5 w-5" />
                  </div>
                  <div className="mt-3 text-xs font-mono uppercase tracking-[0.2em] text-muted-foreground">
                    {it.eyebrow}
                  </div>
                  <h3 className="mt-1 font-display text-2xl font-semibold tracking-tight">{it.title}</h3>
                </div>
                <div className={`md:order-${i % 2 === 0 ? "2" : "1"}`}>
                  <p className="text-base leading-relaxed text-muted-foreground">{it.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function CTASection() {
  return (
    <section className="relative overflow-hidden border-b border-border/60">
      <div className="absolute inset-0 grid-bg opacity-[0.25]" />
      <div className="relative mx-auto max-w-4xl px-6 py-24 text-center">
        <h2 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">
          Stop juggling HR tools.
          <br />
          <span className="text-primary">Start operating.</span>
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
          Sign in as HR or Team Leader and explore a populated demo workspace.
        </p>
        <div className="mt-8">
          <Link
            to="/auth"
            className="group inline-flex h-12 items-center gap-2 rounded-md bg-primary px-7 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:bg-primary/90"
          >
            Enter Workspace
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-6 py-8 text-xs text-muted-foreground sm:flex-row">
        <div className="flex items-center gap-2">
          <LogoMark />
          <span>Mandai · AI HR Operating System</span>
        </div>
        <div className="font-mono">© {new Date().getFullYear()} Mandai</div>
      </div>
    </footer>
  );
}
