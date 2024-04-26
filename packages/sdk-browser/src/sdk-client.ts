import { WebauthnStamper } from "@turnkey/webauthn-stamper";
import { IframeStamper } from "@turnkey/iframe-stamper";
import { getWebAuthnAttestation } from "@turnkey/http";

import { VERSION } from "./__generated__/version";
import WindowWrapper from "./__polyfills__/window";

import type {
  GrpcStatus,
  TurnkeySDKClientConfig,
  TurnkeySDKBrowserConfig,
} from "./__types__/base";

import { TurnkeyRequestError } from "./__types__/base";

import { TurnkeySDKClientBase } from "./__generated__/sdk-client-base";
import type * as SdkApiTypes from "./__generated__/sdk_api_types";

import type { User, SubOrganization } from "./models";
import {
  StorageKeys,
  getStorageValue,
  removeStorageValue,
  setStorageValue,
} from "./storage";
import { generateRandomBuffer, base64UrlEncode } from "./utils";

export class TurnkeyBrowserSDK {
  config: TurnkeySDKBrowserConfig;

  constructor(config: TurnkeySDKBrowserConfig) {
    this.config = config;
  }

  currentUserSession = async (): Promise<TurnkeyBrowserClient | undefined> => {
    const currentUser = await this.getCurrentUser();
    if (!currentUser?.readOnlySession) {
      return;
    }
    if (currentUser?.readOnlySession?.sessionExpiry > Date.now()) {
      return new TurnkeyBrowserClient({
        readOnlySession: currentUser?.readOnlySession?.session!,
        apiBaseUrl: this.config.apiBaseUrl,
        organizationId:
          currentUser?.organization?.organizationId ??
          this.config.defaultOrganizationId,
      });
    } else {
      this.logoutUser();
    }
    return;
  };

  passkeyClient = (rpId?: string): TurnkeyPasskeyClient => {
    const targetRpId = rpId ?? this.config.rpId ?? WindowWrapper.location.hostname;

    if (!targetRpId) {
      throw new Error(
        "Tried to initialize a passkey client with no rpId defined"
      );
    }

    const webauthnStamper = new WebauthnStamper({
      rpId: targetRpId,
    });

    return new TurnkeyPasskeyClient({
      stamper: webauthnStamper,
      apiBaseUrl: this.config.apiBaseUrl,
      organizationId: this.config.defaultOrganizationId,
    });
  };

  iframeClient = async (
    iframeContainer: HTMLElement | null | undefined,
    iframeUrl?: string
  ): Promise<TurnkeyIframeClient> => {
    const targetIframeUrl = iframeUrl ?? this.config.iframeUrl;

    if (!targetIframeUrl) {
      throw new Error(
        "Tried to initialize iframeSigner with no iframeUrl defined"
      );
    }

    const TurnkeyIframeElementId = "turnkey-auth-iframe-element-id";

    const iframeStamper = new IframeStamper({
      iframeUrl: targetIframeUrl,
      iframeElementId: TurnkeyIframeElementId,
      iframeContainer: iframeContainer,
    });

    await iframeStamper.init();

    return new TurnkeyIframeClient({
      stamper: iframeStamper,
      apiBaseUrl: this.config.apiBaseUrl,
      organizationId: this.config.defaultOrganizationId,
    });
  };

  serverSign = async <TResponseType>(
    methodName: string,
    params: any[],
    serverSignUrl?: string
  ): Promise<TResponseType> => {
    const targetServerSignUrl = serverSignUrl ?? this.config.serverSignUrl;

    if (!targetServerSignUrl) {
      throw new Error("Tried to call serverSign with no serverSignUrl defined");
    }

    const stringifiedBody = JSON.stringify({
      methodName: methodName,
      params: params,
    });

    const response = await fetch(targetServerSignUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Client-Version": VERSION,
      },
      body: stringifiedBody,
      redirect: "follow",
    });

    if (!response.ok) {
      let res: GrpcStatus;
      try {
        res = await response.json();
      } catch (_) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      throw new TurnkeyRequestError(res);
    }

    const data = await response.json();
    return data as TResponseType;
  };

  // Local
  getCurrentSubOrganization = async (): Promise<
    SubOrganization | undefined
  > => {
    const currentUser = await this.getCurrentUser();
    return currentUser?.organization;
  };

  getCurrentUser = async (): Promise<User | undefined> => {
    return await getStorageValue(StorageKeys.CurrentUser);
  };

  logoutUser = async (): Promise<boolean> => {
    await removeStorageValue(StorageKeys.CurrentUser);

    return true;
  };
}

export class TurnkeyBrowserClient extends TurnkeySDKClientBase {
  constructor(config: TurnkeySDKClientConfig) {
    super(config);
  }

  login = async (): Promise<SdkApiTypes.TGetWhoamiResponse> => {
    const readOnlySessionResult = await this.createReadOnlySession({});
    const org = {
      organizationId: readOnlySessionResult!.organizationId,
      organizationName: readOnlySessionResult!.organizationName,
    };
    const currentUser: User = {
      userId: readOnlySessionResult!.userId,
      username: readOnlySessionResult!.username,
      organization: org,
      readOnlySession: {
        session: readOnlySessionResult!.session,
        sessionExpiry: Number(readOnlySessionResult!.sessionExpiry),
      },
    };
    await setStorageValue(StorageKeys.CurrentUser, currentUser);
    return readOnlySessionResult!;
  };
}

export class TurnkeyPasskeyClient extends TurnkeyBrowserClient {
  rpId: string;

  constructor(config: TurnkeySDKClientConfig) {
    super(config);
    this.rpId = (config.stamper as WebauthnStamper)!.rpId;
  }

  createUserPasskey = async (config: Record<any, any> = {}) => {
    const challenge = generateRandomBuffer();
    const encodedChallenge = base64UrlEncode(challenge);
    const authenticatorUserId = generateRandomBuffer();

    const webauthnConfig: CredentialCreationOptions = {
      publicKey: {
        rp: {
          id: config.publicKey?.rp?.id ?? this.rpId,
          name: config.publicKey?.rp?.name ?? "",
        },
        challenge: config.publicKey?.challenge ?? challenge,
        pubKeyCredParams: config.publicKey?.pubKeyCredParams ?? [
          {
            type: "public-key",
            alg: -7,
          },
        ],
        user: {
          id: config.publicKey?.user?.id ?? authenticatorUserId,
          name: config.publicKey?.user?.name ?? "",
          displayName: config.publicKey?.user?.displayName ?? "",
        },
        authenticatorSelection: {
          requireResidentKey:
            config.publicKey?.authenticatorSelection?.requireResidentKey ??
            true,
          residentKey:
            config.publicKey?.authenticatorSelection?.residentKey ?? "required",
          userVerification:
            config.publicKey?.authenticatorSelection?.userVerification ??
            "preferred",
        },
      },
    };

    const attestation = await getWebAuthnAttestation(webauthnConfig);

    return {
      encodedChallenge: config.publicKey?.challenge
        ? base64UrlEncode(config.publicKey?.challenge)
        : encodedChallenge,
      attestation: attestation,
    };
  };
}

export class TurnkeyIframeClient extends TurnkeyBrowserClient {
  iframePublicKey: string | null;

  constructor(config: TurnkeySDKClientConfig) {
    super(config);
    this.iframePublicKey = (config.stamper as IframeStamper).iframePublicKey;
  }

  injectCredentialBundle = async (
    credentialBundle: string
  ): Promise<boolean> => {
    const stamper = this.config.stamper as IframeStamper;
    return await stamper.injectCredentialBundle(credentialBundle);
  };
}
