import { ReactNode, createContext, useState, useEffect, useRef } from "react";
import {
  Turnkey,
  TurnkeyIframeClient,
  TurnkeyPasskeyClient,
  TurnkeySDKBrowserConfig,
} from "@turnkey/sdk-browser";

export interface TurnkeyClientType {
  turnkey: Turnkey | undefined;
  authIframeClient: TurnkeyIframeClient | undefined;
  passkeyClient: TurnkeyPasskeyClient | undefined;
}

export const TurnkeyContext = createContext<TurnkeyClientType>({
  turnkey: undefined,
  passkeyClient: undefined,
  authIframeClient: undefined,
});

interface TurnkeyProviderProps {
  children: ReactNode;
  config: TurnkeySDKBrowserConfig;
}

export const TurnkeyProvider: React.FC<TurnkeyProviderProps> = ({
  config,
  children,
}) => {
  const [turnkey, setTurnkey] = useState<Turnkey | undefined>(undefined);
  const [passkeyClient, setPasskeyClient] = useState<
    TurnkeyPasskeyClient | undefined
  >(undefined);
  const [authIframeClient, setAuthIframeClient] = useState<
    TurnkeyIframeClient | undefined
  >(undefined);
  const iframeInit = useRef<boolean>(false);

  const TurnkeyIframeContainerId = "turnkey-default-iframe-container-id";

  useEffect(() => {
    (async () => {
      if (!iframeInit.current) {
        iframeInit.current = true;
        const newTurnkey = new Turnkey(config);
        setTurnkey(newTurnkey);
        setPasskeyClient(newTurnkey.passkeyClient());
        const newAuthIframeClient = await newTurnkey.iframeClient({
          iframeContainer: document.getElementById(TurnkeyIframeContainerId),
          iframeUrl: "https://auth.turnkey.com",
        });
        setAuthIframeClient(newAuthIframeClient);
      }
    })();
  }, []);

  return (
    <TurnkeyContext.Provider
      value={{
        turnkey,
        passkeyClient,
        authIframeClient,
      }}
    >
      {children}
      <div
        className=""
        id={TurnkeyIframeContainerId}
        style={{ display: "none" }}
      />
    </TurnkeyContext.Provider>
  );
};
