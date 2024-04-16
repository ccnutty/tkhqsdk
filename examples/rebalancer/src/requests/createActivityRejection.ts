import type { TurnkeyServerSDK } from "@turnkey/sdk-js-server";
import { TurnkeyActivityError } from "@turnkey/ethers";
import { refineNonNull } from "./utils";

export default async function rejectActivity(
  turnkeyClient: TurnkeyServerSDK,
  activityId: string,
  activityFingerprint: string
): Promise<string> {
  try {
    const activity = await turnkeyClient.api().rejectActivity({
      fingerprint: activityFingerprint,
    });

    const result = refineNonNull(activity);

    // Success!
    // TODO: update once new codegen is in
    console.log(
      [`❌ Rejected activity!`, `- Activity ID: ${result.id}`, ``].join("\n")
    );

    return activityId;
  } catch (error) {
    // If needed, you can read from `TurnkeyActivityError` to find out why the activity didn't succeed
    if (error instanceof TurnkeyActivityError) {
      throw error;
    }

    throw new TurnkeyActivityError({
      message: "Failed to reject activity",
      cause: error as Error,
    });
  }
}
