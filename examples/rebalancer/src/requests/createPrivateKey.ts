import { TurnkeyClient } from "@turnkey/http";
import { createActivityPoller } from "@turnkey/http/dist/async";
import { ApiKeyStamper } from "@turnkey/api-key-stamper";
import { TurnkeyActivityError } from "@turnkey/ethers";

export default async function createPrivateKey(
  privateKeyName: string,
  privateKeyTags: string[]
): Promise<string> {
  const turnkeyClient = new TurnkeyClient(
    { baseUrl: process.env.BASE_URL! },
    new ApiKeyStamper({
      apiPublicKey: process.env.API_PUBLIC_KEY!,
      apiPrivateKey: process.env.API_PRIVATE_KEY!,
    })
  );

  console.log(
    "`process.env.PRIVATE_KEY_ID` not found; creating a new Ethereum private key on Turnkey...\n"
  );

  const activityPoller = createActivityPoller({
    client: turnkeyClient,
    requestFn: turnkeyClient.createPrivateKeys,
  });

  try {
    const activity = await activityPoller({
      type: "ACTIVITY_TYPE_CREATE_PRIVATE_KEYS_V2",
      organizationId: process.env.ORGANIZATION_ID!,
      parameters: {
        privateKeys: [
          {
            privateKeyName,
            privateKeyTags,
            curve: "CURVE_SECP256K1",
            addressFormats: ["ADDRESS_FORMAT_ETHEREUM"],
          },
        ],
      },
      timestampMs: String(Date.now()), // millisecond timestamp
    });

    const privateKeyId = refineNonNull(
      activity.result.createPrivateKeysResultV2?.privateKeys?.[0]?.privateKeyId
    );

    const keyInfo = await turnkeyClient.getPrivateKey({
      organizationId: process.env.ORGANIZATION_ID!,
      privateKeyId,
    });

    const address = refineNonNull(keyInfo.privateKey.addresses[0]?.address);

    // Success!
    console.log(
      [
        `New Ethereum private key created!`,
        `- Name: ${privateKeyName}`,
        `- Private key ID: ${privateKeyId}`,
        `- Address: ${address}`,
        ``,
        "Now you can take the private key ID, put it in `.env.local`, then re-run the script.",
      ].join("\n")
    );

    return privateKeyId;
  } catch (error) {
    // If needed, you can read from `TurnkeyActivityError` to find out why the activity didn't succeed
    if (error instanceof TurnkeyActivityError) {
      throw error;
    }

    throw new TurnkeyActivityError({
      message: "Failed to create a new Ethereum private key",
      cause: error as Error,
    });
  }
}

export function refineNonNull<T>(
  input: T | null | undefined,
  errorMessage?: string
): T {
  if (input == null) {
    throw new Error(errorMessage ?? `Unexpected ${JSON.stringify(input)}`);
  }

  return input;
}
