import { Link, Outlet, useRouterState, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard,
  Users,
  Workflow,
  Wallet,
  LogOut,
  Settings,
  ChevronsLeft,
  ChevronsRight,
  Building2,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { initials } from "@/lib/format";
import { toast } from "sonner";
import { VoiceAssistant } from "@/components/voice-assistant";

type Profile = { id: string; full_name: string | null; org_id: string };
type Org = { id: string; name: string };

const NAV = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { to: "/pipeline", label: "Pipeline", icon: Users },
  { to: "/operations", label: "Operations", icon: Workflow },
  { to: "/financial", label: "Financial", icon: Wallet },
  { to: "/organization", label: "Organization", icon: Building2 },
] as const;

const ROLES = ["Recruiter", "HR", "Finance", "Admin", "Team Leader"] as const;
type Role = (typeof ROLES)[number];

export function AppShell({ children }: { children?: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [role, setRole] = useState<Role>("Admin");
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: profile } = useQuery({
    queryKey: ["me", "profile"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, org_id")
        .maybeSingle();
      if (error) throw error;
      return data as Profile | null;
    },
  });

  const { data: org } = useQuery({
    queryKey: ["me", "org", profile?.org_id],
    enabled: !!profile?.org_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("id, name")
        .eq("id", profile!.org_id)
        .maybeSingle();
      if (error) throw error;
      return data as Org | null;
    },
  });

  useEffect(() => {
    const stored = typeof window !== "undefined" && window.localStorage.getItem("mandai-role");
    if (stored && ROLES.includes(stored as Role)) setRole(stored as Role);
  }, []);

  function changeRole(r: Role) {
    setRole(r);
    try {
      window.localStorage.setItem("mandai-role", r);
    } catch {}
    if (r === "Team Leader") {
      navigate({ to: "/team-leader" });
    } else {
      navigate({ to: "/dashboard" });
    }
  }

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    toast.success("Signed out");
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen w-full bg-background">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          role={role}
          onRoleChange={changeRole}
          profile={profile}
          org={org}
          onSignOut={signOut}
        />
        <main className="flex-1 overflow-x-hidden">
          {children ?? <Outlet />}
        </main>
      </div>
      <VoiceAssistant />
    </div>
  );
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <aside
      className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground md:flex ${collapsed ? "w-[64px]" : "w-[232px]"}`}
    >
      <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-3">
        <Link to="/dashboard" className="flex items-center gap-2 px-1">
          <div className="relative flex h-7 w-7 items-center justify-center rounded-md bg-primary">
            <div className="h-2.5 w-2.5 rounded-sm bg-primary-foreground" />
          </div>
          {!collapsed && <span className="font-display text-base font-semibold tracking-tight">Mandai</span>}
        </Link>
        <Button variant="ghost" size="icon" onClick={onToggle} className="h-7 w-7">
          {collapsed ? <ChevronsRight className="h-3.5 w-3.5" /> : <ChevronsLeft className="h-3.5 w-3.5" />}
        </Button>
      </div>

      <nav className="flex-1 space-y-0.5 p-2">
        {NAV.map((item) => {
          const active = pathname === item.to || pathname.startsWith(item.to + "/");
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`group flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors ${
                active
                  ? "bg-primary/10 text-primary"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              }`}
              title={collapsed ? item.label : undefined}
            >
              <item.icon className={`h-4 w-4 shrink-0 ${active ? "text-primary" : ""}`} />
              {!collapsed && <span>{item.label}</span>}
              {!collapsed && active && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-3 text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
        {collapsed ? "v0.1" : "Mandai · v0.1"}
      </div>
    </aside>
  );
}

function TopBar({
  role,
  onRoleChange,
  profile,
  org,
  onSignOut,
}: {
  role: Role;
  onRoleChange: (r: Role) => void;
  profile: Profile | null | undefined;
  org: Org | null | undefined;
  onSignOut: () => void;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const current = useMemo(() => NAV.find((n) => pathname.startsWith(n.to))?.label ?? "Workspace", [pathname]);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur md:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <Building2 className="h-4 w-4 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{org?.name ?? "Workspace"}</span>
        <span className="text-muted-foreground">/</span>
        <span className="truncate text-sm text-muted-foreground">{current}</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <div className="hidden items-center gap-2 sm:flex">
          <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">Role</span>
          <Select value={role} onValueChange={(v) => onRoleChange(v as Role)}>
            <SelectTrigger className="h-8 w-[120px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r} className="text-xs">
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <AIStatusIndicator />

        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-9 gap-2 px-2">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-primary/10 text-primary text-xs">
                  {initials(profile?.full_name)}
                </AvatarFallback>
              </Avatar>
              <span className="hidden text-sm font-medium sm:inline">{profile?.full_name ?? "Account"}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="font-medium">{profile?.full_name ?? "Member"}</div>
              <div className="text-xs text-muted-foreground">{org?.name}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/settings" className="flex items-center gap-2">
                <Settings className="h-4 w-4" /> Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onSignOut} className="text-destructive focus:text-destructive">
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

function AIStatusIndicator() {
  // Active when any meeting is transcribing/extracting
  const { data } = useQuery({
    queryKey: ["ai", "activity"],
    refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meetings")
        .select("id, status")
        .in("status", ["transcribing", "extracting"])
        .limit(1);
      if (error) return [];
      return data ?? [];
    },
  });
  const active = (data?.length ?? 0) > 0;
  return (
    <div
      className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.18em] md:inline-flex ${
        active
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border bg-card text-muted-foreground"
      }`}
      title={active ? "AI processing" : "AI idle"}
    >
      <span className="relative flex h-1.5 w-1.5">
        {active && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${active ? "bg-primary" : "bg-muted-foreground/50"}`} />
      </span>
      {active ? "AI active" : "AI idle"}
    </div>
  );
}
