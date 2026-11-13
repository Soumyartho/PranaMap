import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate, useLocation } from "react-router";
import { session } from "@/controllers/auth/session";
import type { Role } from "@/models/types/domain";
import { LoginPage } from "@/views/auth/LoginPage";
import { AshaLayout } from "@/views/asha/AshaLayout";
import { TodayPage } from "@/views/asha/TodayPage";
import { HouseholdsPage } from "@/views/asha/HouseholdsPage";
import { HouseholdPage } from "@/views/asha/HouseholdPage";
import { Splash } from "@/views/app/Splash";
import { homeFor } from "./home";

// Map and charts are heavy: the PHC and doctor views load separately so the ASHA route stays small.
const DashboardPage = lazy(() => import("@/views/phc/DashboardPage"));
// The marketing page (scroll effects, smooth scrolling) never ships to an ASHA's phone.
const LandingPage = lazy(() => import("@/views/landing/LandingPage"));
const DoctorPage = lazy(() => import("@/views/doctor/DoctorPage"));
// The screening flow carries the risk engine, the WHO and ML model data, voice and device code:
// it loads when the ASHA opens a screening, not on first paint. Same for referrals and chat (FAQ pack).
const ScreeningPage = lazy(() => import("@/views/asha/ScreeningPage").then((m) => ({ default: m.ScreeningPage })));
const ReferralsPage = lazy(() => import("@/views/asha/ReferralsPage").then((m) => ({ default: m.ReferralsPage })));
const ChatPage = lazy(() => import("@/views/chatbot/ChatPage").then((m) => ({ default: m.ChatPage })));

const lazyEl = (node: ReactNode) => <Suspense fallback={<Splash />}>{node}</Suspense>;

function Guard({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { status, user } = session.use((s) => s);
  const location = useLocation();
  if (status === "booting") return <Splash />;
  if (status !== "ready" || !user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return <>{children}</>;
}

function AppEntry() {
  const { status, user } = session.use((s) => s);
  if (status === "booting") return <Splash />;
  return <Navigate to={status === "ready" ? homeFor(user?.role) : "/login"} replace />;
}

const STAFF: Role[] = ["anm", "medical_officer", "doctor", "district_officer"];

export const router = createBrowserRouter([
  {
    path: "/",
    element: (
      <Suspense fallback={<div className="min-h-svh bg-ink" />}>
        <LandingPage />
      </Suspense>
    ),
  },
  { path: "/app", element: <AppEntry /> },
  { path: "/login", element: <LoginPage /> },
  { path: "/chat", element: lazyEl(<ChatPage standalone />) },
  {
    path: "/asha",
    element: (
      <Guard roles={["asha"]}>
        <AshaLayout />
      </Guard>
    ),
    children: [
      { index: true, element: <TodayPage /> },
      { path: "homes", element: <HouseholdsPage /> },
      { path: "homes/:householdId", element: <HouseholdPage /> },
      { path: "screen/:personId", element: lazyEl(<ScreeningPage />) },
      { path: "referrals", element: lazyEl(<ReferralsPage />) },
      { path: "chat", element: lazyEl(<ChatPage />) },
    ],
  },
  {
    path: "/phc",
    element: (
      <Guard roles={STAFF}>
        <Suspense fallback={<Splash />}>
          <DashboardPage />
        </Suspense>
      </Guard>
    ),
  },
  {
    path: "/doctor",
    element: (
      <Guard roles={["doctor", "medical_officer"]}>
        <Suspense fallback={<Splash />}>
          <DoctorPage />
        </Suspense>
      </Guard>
    ),
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
