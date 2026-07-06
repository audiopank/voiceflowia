import { createRootRoute, Outlet } from "@tanstack/react-router";
import "@/app.css";
import { TrialStatus } from "@/components/TrialStatus";

export const Route = createRootRoute({
  component: () => (
    <>
      <TrialStatus />
      <Outlet />
    </>
  ),
});
