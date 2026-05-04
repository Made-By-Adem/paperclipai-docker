import type { SidebarBadges } from "@agentsai/shared";
import { api } from "./client";

export const sidebarBadgesApi = {
  get: (companyId: string) => api.get<SidebarBadges>(`/companies/${companyId}/sidebar-badges`),
};
