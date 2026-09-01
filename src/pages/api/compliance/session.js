import { json } from "../../../lib/portalApi";
import { requireApprovedSession } from "../../../lib/complianceSession";

export const prerender = false;

export async function GET(context) {
  const approved = await requireApprovedSession(context);

  return json(
    approved
      ? {
          success: true,
          approved: true,
          user: approved.user,
          policyVersion: approved.compliance.policyVersion,
          acceptedAt: approved.compliance.acceptedAt,
        }
      : {
          success: false,
          approved: false,
          message: "A signed-in, approved 21+ research-use session is required.",
        },
    approved ? 200 : 401,
  );
}
