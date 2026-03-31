import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { DashboardClient } from "./dashboard-client";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <DashboardClient username={session.username} />;
}
