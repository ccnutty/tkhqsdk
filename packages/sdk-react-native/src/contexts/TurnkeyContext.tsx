import {
  type ReactNode,
  type FC,
  createContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  generateP256KeyPair,
  getPublicKey,
  decryptCredentialBundle,
  encryptWalletToBundle,
  decryptExportBundle,
} from "@turnkey/crypto";
import { uint8ArrayToHexString } from "@turnkey/encoding";
import { TurnkeyClient } from "@turnkey/http";
import {
  TURNKEY_SESSION_STORAGE,
  OTP_AUTH_DEFAULT_EXPIRATION_SECONDS,
} from "../constant";
import type {
  Activity,
  HashFunction,
  PayloadEncoding,
  Session,
  SignRawPayloadResult,
  User,
  WalletAccountParams,
} from "../types";
import { TurnkeyReactNativeError } from "../errors";
import { ApiKeyStamper } from "@turnkey/api-key-stamper";
import {
  getSelectedSessionKey,
  saveSelectedSessionKey,
  addSessionKeyToIndex,
  getSessionKeysIndex,
  removeSessionKeyFromIndex,
  clearSelectedSessionKey,
} from "../storage/asyncStorage";
import {
  getEmbeddedKey,
  getSession,
  resetSession,
  saveEmbeddedKey,
  saveSession,
} from "../storage/secureStorage";

export interface TurnkeyContextType {
  session: Session | undefined;
  client: TurnkeyClient | undefined;
  user: User | undefined;
  setSelectedSession: (sessionKey: string) => Promise<Session | undefined>;
  updateUser: (userDetails: {
    email?: string;
    phone?: string;
  }) => Promise<Activity>;
  refreshUser: () => Promise<void>;
  createEmbeddedKey: () => Promise<string>;
  createSession: (
    bundle: string,
    expiry?: number,
    sessionKey?: string,
  ) => Promise<Session>;
  clearSession: (sessionKey?: string) => Promise<void>;
  createWallet: (params: {
    walletName: string;
    accounts: WalletAccountParams[];
    mnemonicLength?: number;
  }) => Promise<Activity>;
  importWallet: (params: {
    walletName: string;
    mnemonic: string;
    accounts: WalletAccountParams[];
  }) => Promise<Activity>;
  exportWallet: (params: { walletId: string }) => Promise<string>;
  signRawPayload: (params: {
    signWith: string;
    payload: string;
    encoding: PayloadEncoding;
    hashFunction: HashFunction;
  }) => Promise<SignRawPayloadResult>;
}

export const TurnkeyContext = createContext<TurnkeyContextType | undefined>(
  undefined,
);

export interface TurnkeyConfig {
  apiBaseUrl: string;
  organizationId: string;
  onSessionCreated?: (session: Session) => void;
  onSessionExpired?: (session: Session) => void;
  onSessionCleared?: (session: Session) => void;
}

export const TurnkeyProvider: FC<{
  children: ReactNode;
  config: TurnkeyConfig;
}> = ({ children, config }) => {
  const [session, setSession] = useState<Session | undefined>(undefined);
  const [client, setClient] = useState<TurnkeyClient | undefined>(undefined);

  // A map to track expiration timers for each session (keyed by sessionKey)
  const expiryTimeoutsRef = useRef<{ [key: string]: NodeJS.Timeout }>({});

  // On mount: load all sessions from the index, schedule expirations, then load the selected session.
  useEffect(() => {
    (async () => {
      const sessionKeys = await getSessionKeysIndex();

      // we schedule expirations for all sessions that are stored or clear them if they are expired
      for (const key of sessionKeys) {
        const session = await getSession(key);

        if (session?.expiry && session.expiry > Date.now()) {
          scheduleSessionExpiration(key, session.expiry);
        } else {
          await clearSession(key);
          await removeSessionKeyFromIndex(key);
        }
      }

      // we load the selected session or clea it if it's expired
      const selectedKey = await getSelectedSessionKey();
      if (selectedKey) {
        const selectedSession = await getSession(selectedKey);
        if (selectedSession?.expiry && selectedSession.expiry > Date.now()) {
          setSession(selectedSession);
          const clientInstance = createClient(
            selectedSession.publicKey,
            selectedSession.privateKey,
            config.apiBaseUrl,
          );
          setClient(clientInstance);
          config.onSessionCreated?.(selectedSession);
        } else {
          await clearSession(selectedKey);
          config.onSessionExpired?.(
            selectedSession ?? ({ key: selectedKey } as Session),
          );
        }
      }
    })();

    return () => {
      clearTimeouts();
    };
  }, []);

  const setSelectedSession = async (sessionKey: string) => {
    const session = await getSession(sessionKey);

    if (session?.expiry && session.expiry > Date.now()) {
      const clientInstance = createClient(
        session.publicKey,
        session.privateKey,
        config.apiBaseUrl,
      );

      setClient(clientInstance);
      setSession(session);
      await saveSelectedSessionKey(sessionKey);

      config.onSessionCreated?.(session);
      scheduleSessionExpiration(sessionKey, session.expiry);
      return session;
    } else {
      await clearSession(sessionKey);
      config.onSessionExpired?.(session ?? ({ key: sessionKey } as Session));
      return undefined;
    }
  };

  // clears all scheduled expiration timers.
  const clearTimeouts = () => {
    Object.values(expiryTimeoutsRef.current).forEach((timer) =>
      clearTimeout(timer),
    );
    expiryTimeoutsRef.current = {};
  };

  // Schedule expiration for a session identified by its sessionKey.
  const scheduleSessionExpiration = (
    sessionKey: string,
    expiryTime: number,
  ) => {
    if (expiryTimeoutsRef.current[sessionKey]) {
      clearTimeout(expiryTimeoutsRef.current[sessionKey]);
    }
    const timeUntilExpiry = expiryTime - Date.now();
    if (timeUntilExpiry > 0) {
      expiryTimeoutsRef.current[sessionKey] = setTimeout(async () => {
        // Capture the expired session before clearing it.
        const expiredSession = await getSession(sessionKey);
        await clearSession(sessionKey);
        config.onSessionExpired?.(
          expiredSession ?? ({ key: sessionKey } as Session),
        );
        delete expiryTimeoutsRef.current[sessionKey];
      }, timeUntilExpiry);
    } else {
      clearSession(sessionKey);
      config.onSessionExpired?.({ key: sessionKey } as Session);
    }
  };

  const createClient = (
    publicKey: string,
    privateKey: string,
    apiBaseUrl: string,
  ): TurnkeyClient => {
    const stamper = new ApiKeyStamper({
      apiPrivateKey: privateKey,
      apiPublicKey: publicKey,
    });
    return new TurnkeyClient({ baseUrl: apiBaseUrl }, stamper);
  };

  const fetchUser = async (
    client: TurnkeyClient,
    organizationId: string,
  ): Promise<User | undefined> => {
    const whoami = await client.getWhoami({ organizationId });
    if (whoami.userId && whoami.organizationId) {
      const [walletsResponse, userResponse] = await Promise.all([
        client.getWallets({ organizationId: whoami.organizationId }),
        client.getUser({
          organizationId: whoami.organizationId,
          userId: whoami.userId,
        }),
      ]);
      const wallets = await Promise.all(
        walletsResponse.wallets.map(async (wallet) => {
          const accounts = await client.getWalletAccounts({
            organizationId: whoami.organizationId,
            walletId: wallet.walletId,
          });
          return {
            name: wallet.walletName,
            id: wallet.walletId,
            accounts: accounts.accounts.map((account) => ({
              id: account.walletAccountId,
              curve: account.curve,
              pathFormat: account.pathFormat,
              path: account.path,
              addressFormat: account.addressFormat,
              address: account.address,
              createdAt: account.createdAt,
              updatedAt: account.updatedAt,
            })),
          };
        }),
      );
      const user = userResponse.user;
      return {
        id: user.userId,
        userName: user.userName,
        email: user.userEmail,
        phoneNumber: user.userPhoneNumber,
        organizationId: whoami.organizationId,
        wallets,
      };
    }
    return undefined;
  };

  const updateUser = async (userDetails: {
    email?: string;
    phone?: string;
  }) => {
    if (client == null || session?.user == null) {
      throw new TurnkeyReactNativeError("Client or user not initialized");
    }
    const parameters = {
      userId: session.user.id,
      userTagIds: [] as string[],
      ...(userDetails.phone?.trim() && { userPhoneNumber: userDetails.phone }),
      ...(userDetails.email?.trim() && { userEmail: userDetails.email }),
    };

    const result = await client.updateUser({
      type: "ACTIVITY_TYPE_UPDATE_USER",
      timestampMs: Date.now().toString(),
      organizationId: session.user.organizationId,
      parameters,
    });

    const activity = result.activity;
    if (activity.result.updateUserResult?.userId) {
      await refreshUser();
    }

    return activity;
  };

  const refreshUser = async () => {
    if (session && client) {
      const updatedUser = await fetchUser(client, config.organizationId);
      if (updatedUser) {
        const updatedSession: Session = { ...session, user: updatedUser };
        await saveSession(updatedSession, updatedSession.key);
        setSession(updatedSession);
      }
    }
  };

  const createEmbeddedKey = async () => {
    const key = generateP256KeyPair();
    const embeddedPrivateKey = key.privateKey;
    const publicKey = key.publicKeyUncompressed;
    await saveEmbeddedKey(embeddedPrivateKey);
    return publicKey;
  };

  const createSession = async (
    bundle: string,
    expirySeconds: number = OTP_AUTH_DEFAULT_EXPIRATION_SECONDS,
    sessionKey: string = TURNKEY_SESSION_STORAGE,
  ): Promise<Session> => {
    const embeddedKey = await getEmbeddedKey();
    if (!embeddedKey) {
      throw new TurnkeyReactNativeError("Embedded key not found.");
    }
    const privateKey = decryptCredentialBundle(bundle, embeddedKey);
    const publicKey = uint8ArrayToHexString(getPublicKey(privateKey));
    const expiry = Date.now() + expirySeconds * 1000;

    const clientInstance = createClient(
      publicKey,
      privateKey,
      config.apiBaseUrl,
    );
    const user = await fetchUser(clientInstance, config.organizationId);
    if (!user) {
      throw new TurnkeyReactNativeError("User not found.");
    }

    const newSession = { key: sessionKey, publicKey, privateKey, expiry, user };
    await saveSession(newSession, sessionKey);
    setClient(clientInstance);
    setSession(newSession);

    await saveSelectedSessionKey(sessionKey);
    await addSessionKeyToIndex(sessionKey);

    config.onSessionCreated?.(newSession);
    return newSession;
  };

  const clearSession = async (sessionKey: string = TURNKEY_SESSION_STORAGE) => {
    try {
      const clearedSession = await getSession(sessionKey);

      // if selected session is being cleared, clear the local state session and client
      if (session?.key === sessionKey) {
        setSession(undefined);
        setClient(undefined);
        await clearSelectedSessionKey();
      }

      await resetSession(sessionKey);
      await removeSessionKeyFromIndex(sessionKey);
      config.onSessionCleared?.(
        clearedSession ?? ({ key: sessionKey } as Session),
      );
    } catch (error) {
      throw new TurnkeyReactNativeError("Could not clear the session.");
    }
  };

  const createWallet = async ({
    walletName,
    accounts,
    mnemonicLength,
  }: {
    walletName: string;
    accounts: WalletAccountParams[];
    mnemonicLength?: number;
  }): Promise<Activity> => {
    if (client == null || session?.user == null) {
      throw new TurnkeyReactNativeError("Client or user not initialized");
    }
    const parameters: any = { walletName, accounts };
    if (mnemonicLength != null) {
      parameters.mnemonicLength = mnemonicLength;
    }
    const response = await client.createWallet({
      type: "ACTIVITY_TYPE_CREATE_WALLET",
      timestampMs: Date.now().toString(),
      organizationId: session.user.organizationId,
      parameters,
    });
    const activity = response.activity;
    if (activity.result.createWalletResult?.walletId) {
      await refreshUser();
    }
    return activity;
  };

  const importWallet = async ({
    walletName,
    mnemonic,
    accounts,
  }: {
    walletName: string;
    mnemonic: string;
    accounts: WalletAccountParams[];
  }): Promise<Activity> => {
    if (client == null || session?.user == null) {
      throw new TurnkeyReactNativeError("Client or user not initialized");
    }
    const initResponse = await client.initImportWallet({
      type: "ACTIVITY_TYPE_INIT_IMPORT_WALLET",
      timestampMs: Date.now().toString(),
      organizationId: session.user.organizationId,
      parameters: { userId: session.user.id },
    });
    const importBundle =
      initResponse.activity.result.initImportWalletResult?.importBundle;
    if (importBundle == null) {
      throw new TurnkeyReactNativeError("Failed to get import bundle");
    }
    const encryptedBundle = await encryptWalletToBundle({
      mnemonic,
      importBundle,
      userId: session.user.id,
      organizationId: session.user.organizationId,
    });
    const response = await client.importWallet({
      type: "ACTIVITY_TYPE_IMPORT_WALLET",
      timestampMs: Date.now().toString(),
      organizationId: session.user.organizationId,
      parameters: {
        userId: session.user.id,
        walletName,
        encryptedBundle,
        accounts,
      },
    });
    const activity = response.activity;
    if (activity.result.importWalletResult?.walletId) {
      await refreshUser();
    }
    return activity;
  };

  const exportWallet = async ({
    walletId,
  }: {
    walletId: string;
  }): Promise<string> => {
    const { publicKeyUncompressed: targetPublicKey, privateKey: embeddedKey } =
      generateP256KeyPair();
    if (client == null || session?.user == null) {
      throw new TurnkeyReactNativeError("Client or user not initialized");
    }
    const response = await client.exportWallet({
      type: "ACTIVITY_TYPE_EXPORT_WALLET",
      timestampMs: Date.now().toString(),
      organizationId: session.user.organizationId,
      parameters: { walletId, targetPublicKey },
    });
    const exportBundle =
      response.activity.result.exportWalletResult?.exportBundle;
    if (exportBundle == null || embeddedKey == null) {
      throw new TurnkeyReactNativeError(
        "Export bundle, embedded key, or user not initialized",
      );
    }
    return await decryptExportBundle({
      exportBundle,
      embeddedKey,
      organizationId: session.user.organizationId,
      returnMnemonic: true,
    });
  };

  const signRawPayload = async ({
    signWith,
    payload,
    encoding,
    hashFunction,
  }: {
    signWith: string;
    payload: string;
    encoding: PayloadEncoding;
    hashFunction: HashFunction;
  }): Promise<SignRawPayloadResult> => {
    if (client == null || session?.user == null) {
      throw new TurnkeyReactNativeError("Client or user not initialized");
    }
    const response = await client.signRawPayload({
      type: "ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2",
      timestampMs: Date.now().toString(),
      organizationId: session.user.organizationId,
      parameters: { signWith, payload, encoding, hashFunction },
    });
    const signRawPayloadResult = response.activity.result.signRawPayloadResult;
    if (signRawPayloadResult == null) {
      throw new TurnkeyReactNativeError("Failed to sign raw payload");
    }
    return signRawPayloadResult;
  };

  return (
    <TurnkeyContext.Provider
      value={{
        session,
        client,
        user: session?.user,
        setSelectedSession,
        updateUser,
        refreshUser,
        createEmbeddedKey,
        createSession,
        clearSession,
        createWallet,
        importWallet,
        exportWallet,
        signRawPayload,
      }}
    >
      {children}
    </TurnkeyContext.Provider>
  );
};
