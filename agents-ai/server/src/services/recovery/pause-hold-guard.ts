import type { Db } from "@agentsai/db";
import { issueTreeControlService } from "../issue-tree-control.js";

type IssueTreeControlService = ReturnType<typeof issueTreeControlService>;

export async function isAutomaticRecoverySuppressedByPauseHold(
  db: Db,
  companyId: string,
  issueId: string,
  treeControlSvc: IssueTreeControlService = issueTreeControlService(db),
) {
  const activePauseHold = await treeControlSvc.getActivePauseHoldGate(companyId, issueId);
  return Boolean(activePauseHold);
}
