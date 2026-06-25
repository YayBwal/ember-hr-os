import { Link, Outlet, useRouterState, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, lazy, Suspense } from "react";
import {
  Users,
  Workflow,
  Wallet,
  MessageSquare,
  LogOut,
  Settings,
  ChevronsLeft,
  ChevronsRight,
  Building2,
  UserCog,
  Crown,
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
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { initials } from "@/lib/format";
import { toast } from "sonner";
const AssistantDock = lazy(() =>
  import("@/components/assistant-dock").then((m) => ({ default: m.AssistantDock })),
);

function DeferredAssistants() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    const schedule = w.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
    const id = schedule(() => setReady(true));
    return () => {
      if (typeof id === "number") window.clearTimeout(id);
    };
  }, []);
  if (!ready) return null;
  return (
    <Suspense fallback={null}>
      <AssistantDock />
    </Suspense>
  );
}

type Profile = { id: string; full_name: string | null; org_id: string };
type Org = { id: string; name: string };

const NAV = [
  { to: "/pipeline", label: "Pipeline", icon: Users },
  { to: "/operations", label: "Operations", icon: Workflow },
  { to: "/financial", label: "Financial", icon: Wallet },
  { to: "/feedbacks", label: "Feedbacks", icon: MessageSquare },
] as const;

const ROLES = ["HR", "Team Leader"] as const;
type Role = (typeof ROLES)[number];

function useRoleState(): [Role, (r: Role) => void] {
  const [role, setRole] = useState<Role>("HR");
  useEffect(() => {
    const stored = typeof window !== "undefined" && window.localStorage.getItem("mandai-role");
    if (stored && (ROLES as readonly string[]).includes(stored)) setRole(stored as Role);
  }, []);
  return [role, setRole];
}

export function AppShell({ children }: { children?: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [role, setRole] = useRoleState();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

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

  // Keep the route in sync with the selected role.
  useEffect(() => {
    if (role === "Team Leader" && pathname !== "/team-leader" && !pathname.startsWith("/auth") && !pathname.startsWith("/settings")) {
      navigate({ to: "/team-leader" });
    } else if (role === "HR" && pathname === "/team-leader") {
      navigate({ to: "/operations" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, pathname]);

  function changeRole(r: Role) {
    setRole(r);
    try { window.localStorage.setItem("mandai-role", r); } catch {}
    if (r === "Team Leader") navigate({ to: "/team-leader" });
    else navigate({ to: "/operations" });
  }

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    toast.success("Signed out");
    navigate({ to: "/auth", replace: true });
  }

  // Team Leader: no chrome at all — only the page + a floating account widget.
  if (role === "Team Leader") {
    return (
      <div className="min-h-screen w-full bg-background">
        <main className="min-h-screen">{children ?? <Outlet />}</main>
        <FloatingAccount
          role={role}
          onRoleChange={changeRole}
          profile={profile}
          org={org}
          onSignOut={signOut}
        />
        <DeferredAssistants />
      </div>
    );
  }

  // HR: sidebar only, no top nav bar.
  return (
    <div className="flex min-h-screen w-full bg-background">
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        role={role}
        onRoleChange={changeRole}
        profile={profile}
        org={org}
        onSignOut={signOut}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex-1 overflow-x-hidden">{children ?? <Outlet />}</main>
      </div>
      <DeferredAssistants />
    </div>
  );
}

function Sidebar({
  collapsed,
  onToggle,
  role,
  onRoleChange,
  profile,
  org,
  onSignOut,
}: {
  collapsed: boolean;
  onToggle: () => void;
  role: Role;
  onRoleChange: (r: Role) => void;
  profile: Profile | null | undefined;
  org: Org | null | undefined;
  onSignOut: () => void;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <aside
      className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground md:flex ${collapsed ? "w-[64px]" : "w-[232px]"}`}
    >
      <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-3">
        <Link to="/operations" className="flex items-center gap-2 px-1">
          <img src={logoAsset.url} alt="Mandai" className="h-9 w-9 object-contain" />
          {!collapsed && <span className="font-display text-base font-semibold tracking-tight">Mandai</span>}
        </Link>
        <Button variant="ghost" size="icon" onClick={onToggle} className="h-7 w-7">
          {collapsed ? <ChevronsRight className="h-3.5 w-3.5" /> : <ChevronsLeft className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {!collapsed && (
        <div className="border-b border-sidebar-border px-3 py-2">
          <div className="flex items-center gap-2">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="truncate text-xs font-medium">{org?.name ?? "Workspace"}</span>
          </div>
        </div>
      )}

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
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

      <div className="border-t border-sidebar-border p-2 space-y-1">
        {!collapsed && (
          <button
            onClick={() => onRoleChange("Team Leader")}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            title="Switch to Team Leader view"
          >
            <Crown className="h-3.5 w-3.5 text-amber-500" />
            <span>Switch to Team Leader</span>
          </button>
        )}
        {collapsed && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onRoleChange("Team Leader")}
            title="Switch to Team Leader"
          >
            <Crown className="h-4 w-4 text-amber-500" />
          </Button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-sidebar-accent">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-primary/10 text-primary text-xs">
                  {initials(profile?.full_name)}
                </AvatarFallback>
              </Avatar>
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{profile?.full_name ?? "Account"}</div>
                  <div className="truncate text-[10px] text-muted-foreground">{role}</div>
                </div>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-56">
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
            <DropdownMenuItem onClick={() => onRoleChange(role === "HR" ? "Team Leader" : "HR")}>
              <UserCog className="mr-2 h-4 w-4" /> Switch role
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5"><ThemeToggle /></div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onSignOut} className="text-destructive focus:text-destructive">
              <LogOut className="mr-2 h-4 w-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}

function FloatingAccount({
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
  return (
    <div className="fixed right-4 top-4 z-40">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="h-9 gap-2 rounded-full bg-background/80 px-2 backdrop-blur">
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
            <div className="text-xs text-muted-foreground">{org?.name} · {role}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onRoleChange("HR")}>
            <UserCog className="mr-2 h-4 w-4" /> Switch to HR
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <div className="px-2 py-1.5"><ThemeToggle /></div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onSignOut} className="text-destructive focus:text-destructive">
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
