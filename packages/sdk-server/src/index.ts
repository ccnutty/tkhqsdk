import {
  ApiKeyStamper,
  signWithApiKey,
  TApiKeyStamperConfig,
} from "@turnkey/api-key-stamper";

import {
  createActivityPoller,
  getWebAuthnAttestation,
  sealAndStampRequestBody,
  TSignedRequest,
  TurnkeyActivityError,
  TurnkeyApi,
  TurnkeyApiTypes,
  TurnkeyRequestError,
} from "@turnkey/http";

import {
  TurnkeyServerSDK,
  TurnkeyServerClient,
  TurnkeyApiClient,
} from "./sdk-client";

import {
  defaultEthereumAccountAtIndex,
  DEFAULT_ETHEREUM_ACCOUNTS,
  TERMINAL_ACTIVITY_STATUSES,
} from "./turnkey-helpers";

import type {
  TurnkeySDKClientConfig,
  TurnkeySDKServerConfig,
  TurnkeyProxyHandlerConfig,
  TActivityStatus,
} from "./__types__/base";

import type * as TurnkeySDKApiTypes from "./__generated__/sdk_api_types";

import { fetch } from "./universal";

// Classes
export {
  ApiKeyStamper,
  TurnkeyActivityError,
  TurnkeyApiClient,
  TurnkeyServerSDK as Turnkey,
  TurnkeyServerClient,
  TurnkeyRequestError,
};

// Types
export type {
  TActivityStatus,
  TApiKeyStamperConfig,
  TSignedRequest,
  TurnkeyApiTypes,
  TurnkeySDKApiTypes,
  TurnkeySDKClientConfig,
  TurnkeySDKServerConfig,
  TurnkeyProxyHandlerConfig,
};

// Functions
export {
  fetch,
  createActivityPoller,
  defaultEthereumAccountAtIndex,
  getWebAuthnAttestation,
  sealAndStampRequestBody,
  signWithApiKey,
};

// Constants
export { DEFAULT_ETHEREUM_ACCOUNTS, TERMINAL_ACTIVITY_STATUSES };

// Base Turnkey API
export { TurnkeyApi };
