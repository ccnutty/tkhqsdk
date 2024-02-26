const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { promisify } = require("util");
const glob = require("glob");

const asyncGlob = promisify(glob);

const SOURCE_DIRECTORY = path.resolve(__dirname, "../src");
const PUBLIC_API_SWAGGER_PATH = path.resolve(`${SOURCE_DIRECTORY}/__generated__`, "public_api.swagger.json");
const TARGET_API_TYPES_PATH = path.resolve(`${SOURCE_DIRECTORY}/__generated__`, "sdk_api_types.ts");
const TARGET_SDK_CLIENT_PATH = path.resolve(SOURCE_DIRECTORY, "sdk-client-base.ts");

const COMMENT_HEADER = "/* @generated by codegen. DO NOT EDIT BY HAND */";
const STAMP_HEADER_FIELD_KEY = "X-Stamp-Webauthn";

// Helper Functions
/**
 * @param {Array<string | null>} input
 * @returns {string}
 */
function joinPropertyList(input) {
  return input.filter(Boolean).join(",\n");
}

/**
 * @param {string} methodName
 * @returns {string}
 */
function methodTypeFromMethodName(methodName) {
  if (["approveActivity", "rejectActivity"].includes(methodName)) { return "activityDecision"; }
  if (methodName.startsWith("nOOP")) { return "noop"; }
  if (methodName.startsWith("get") || methodName.startsWith("list")) { return "query"; }
  return "command";
}

// Generators
const generateApiTypesFromSwagger = async (swaggerSpec, targetPath) => {
  const namespace = swaggerSpec.tags?.find((item) => item.name != null)?.name;

  /** @type {Array<string>} */
  const codeBuffer = [];

  /** @type {Array<string>} */
  const imports = [];

  imports.push(
    'import type { operations } from "./public_api.types";'
  )

  for (const endpointPath in swaggerSpec.paths) {
    const methodMap = swaggerSpec.paths[endpointPath];
    const operation = methodMap.post;
    const operationId = operation.operationId;

    const operationNameWithoutNamespace = operationId.replace(
      new RegExp(`${namespace}_`),
      ""
    );

    const isEndpointDeprecated = Boolean(operation.deprecated);

    const methodName = `${
      operationNameWithoutNamespace.charAt(0).toLowerCase() +
      operationNameWithoutNamespace.slice(1)
    }`;

    const methodType = methodTypeFromMethodName(methodName);
    const signedRequestGeneratorName = `sign${methodName}`;
    const parameterList = operation["parameters"] ?? [];

    let responseValue = "void";
    if (methodType === "command") {
      responseValue = `operations["${operationId}"]["responses"]["200"]["schema"]["activity"]["result"]["${methodName}Result"]`;
    } else if (["noop", "query"].includes(methodType)) {
      responseValue = `operations["${operationId}"]["responses"]["200"]["schema"]`;
    } else if (methodType === "activityDecision") {
      responseValue = `operations["${operationId}"]["responses"]["200"]["schema"]["activity"]["result"]`;
    }

    /** @type {TBinding} */
    const responseTypeBinding = {
      name: `T${operationNameWithoutNamespace}Response`,
      isBound: true,
      value: operation.responses["200"] == null ? `void` : responseValue
    };

    let bodyValue = "{}";
    if (["activityDecision", "command"].includes(methodType)) {
      bodyValue = `operations["${operationId}"]["parameters"]["body"]["body"]["parameters"]`;
    } else if (methodType === "query") {
      bodyValue = `Omit<operations["${operationId}"]["parameters"]["body"]["body"], "organizationId">`;
    }

    /** @type {TBinding} */
    const bodyTypeBinding = {
      name: `T${operationNameWithoutNamespace}Body`,
      isBound: parameterList.find((item) => item.in === "body") != null,
      value: bodyValue
    };

    // What are these used for?
    /** @type {TBinding} */
    const queryTypeBinding = {
      name: `T${operationNameWithoutNamespace}Query`,
      isBound: parameterList.find((item) => item.in === "query") != null,
      value: `operations["${operationId}"]["parameters"]["query"]`
    };

    /** @type {TBinding} */
    const substitutionTypeBinding = {
      name: `T${operationNameWithoutNamespace}Substitution`,
      isBound: parameterList.find((item) => item.in === "path") != null,
      value: `operations["${operationId}"]["parameters"]["path"]`
    };

    /** @type {TBinding} */
    const inputTypeBinding = {
      name: `T${operationNameWithoutNamespace}Input`,
      isBound:
        bodyTypeBinding.isBound ||
        queryTypeBinding.isBound ||
        substitutionTypeBinding.isBound,
      value: `{ ${joinPropertyList([
        bodyTypeBinding.isBound ? `body: ${bodyTypeBinding.name}` : null,
        queryTypeBinding.isBound ? `query: ${queryTypeBinding.name}` : null,
        substitutionTypeBinding.isBound ? `substitution: ${substitutionTypeBinding.name}` : null
      ])} }`
    }

    // local type aliases
    codeBuffer.push(
      ...[queryTypeBinding, substitutionTypeBinding]
        .filter((binding) => binding.isBound)
        .map((binding) => `type ${binding.name} = ${binding.value};`)
    );

    // exported type aliases
    codeBuffer.push(
      ...[responseTypeBinding, inputTypeBinding, bodyTypeBinding]
        .filter((binding) => binding.isBound)
        .map((binding) => `export type ${binding.name} = ${binding.value};`)
    );

  }

  await fs.promises.writeFile(
    targetPath,
    [COMMENT_HEADER].concat(imports).concat(codeBuffer).join("\n\n")
  );
}

const generateSDKClientFromSwagger = async (swaggerSpec, targetPath) => {
  const namespace = swaggerSpec.tags?.find((item) => item.name != null)?.name;

  /** @type {Array<string>} */
  const codeBuffer = [];

  /** @type {Array<string>} */
  const imports = [];

  imports.push(
    'import { GrpcStatus, THttpConfig, TStamper, TurnkeyRequestError } from "./__types__/base";'
  )

  imports.push(
    'import { VERSION } from "./__generated__/version";'
  )

  imports.push(
    'import * as SdkApiTypes from "./__generated__/sdk_api_types";'
  )

  codeBuffer.push(`
export class TurnkeySDKClientBase {
  organizationId: string;
  stamper: TStamper;
  httpConfig: THttpConfig;

  constructor(organizationId: string, httpConfig: THttpConfig, stamper: TStamper) {
    this.organizationId = organizationId;
    this.httpConfig = httpConfig;
    this.stamper = stamper;
  }

  async query<TBodyType, TResponseType>(
    url: string,
    body: TBodyType
  ): Promise<TResponseType> {
    const fullUrl = this.httpConfig.baseUrl + url;
    const stringifiedBody = JSON.stringify(body);
    const stamp = await this.stamper.stamp(stringifiedBody);

    const response = await fetch(fullUrl, {
      method: "POST",
      headers: {
        [stamp.stampHeaderName]: stamp.stampHeaderValue,
        "X-Client-Version": VERSION
      },
      body: stringifiedBody,
      redirect: "follow"
    });

    if (!response.ok) {
      let res: GrpcStatus;
      try {
        res = await response.json();
      } catch (_) {
        throw new Error(\`\${response.status} \${response.statusText}\`);
      }

      throw new TurnkeyRequestError(res);
    }

    const data = await response.json();
    return data as TResponseType;
  }

  async command<TBodyType, TResponseType>(
    url: string,
    body: TBodyType,
    methodName: string
  ): Promise<TResponseType> {
    const POLLING_DURATION = 1000;
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    const initialData: TResponseType = await this.query<TBodyType, TResponseType>(url, body);
    const activityId = initialData["activity"]["id"];
    let activityStatus = initialData["activity"]["status"];

    if (activityStatus !== "ACTIVITY_STATUS_PENDING") {
      return initialData["activity"]["result"][\`\${methodName}Result\`];
    }

    const pollStatus = async (): Promise<TResponseType> => {
      const pollBody = { activityId: activityId };
      const pollData = await this.getActivity(pollBody);
      const activityStatus = pollData["activity"]["status"];

      if (activityStatus === "ACTIVITY_STATUS_PENDING") {
        await delay(POLLING_DURATION);
        return await pollStatus();
      } else {
        return pollData["activity"]["result"][\`\${methodName}Result\`];
      }
    }

    return await pollStatus();
  }

  async activityDecision<TBodyType, TResponseType>(
    url: string,
    body: TBodyType
  ): Promise<TResponseType> {
    const data: TResponseType = await this.query(url, body);
    return data["activity"]["result"];
  }

  `);

  for (const endpointPath in swaggerSpec.paths) {
    const methodMap = swaggerSpec.paths[endpointPath];
    const operation = methodMap.post;
    const operationId = operation.operationId;

    const operationNameWithoutNamespace = operationId.replace(
      new RegExp(`${namespace}_`),
      ""
    );

    if (operationNameWithoutNamespace === "NOOPCodegenAnchor") {
      continue;
    }

    const isEndpointDeprecated = Boolean(operation.deprecated);

    const methodName = `${
      operationNameWithoutNamespace.charAt(0).toLowerCase() +
      operationNameWithoutNamespace.slice(1)
    }`;

    const methodType = methodTypeFromMethodName(methodName);
    const inputType = `T${operationNameWithoutNamespace}Body`;
    const responseType = `T${operationNameWithoutNamespace}Response`;

    if (methodType === "query") {
      codeBuffer.push(
        `\n\t${methodName} = async (input: SdkApiTypes.${inputType}, overrideParams?: any): Promise<SdkApiTypes.${responseType}> => {
    return this.query("${endpointPath}", {
      ...{
        ...input,
        organizationId: this.organizationId
      }, ...overrideParams
    });
  }`
      );
    } else if (methodType === "command") {
      codeBuffer.push(
      `\n\t${methodName} = async (input: SdkApiTypes.${inputType}, overrideParams?: any): Promise<SdkApiTypes.${responseType}> => {
    return this.command("${endpointPath}", {
      ...{
        parameters: {...input},
        organizationId: this.organizationId,
        timestampMs: String(Date.now()),
        type: "ACTIVITY_TYPE_${operationNameWithoutNamespace.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}"
      },
      ...overrideParams
    },
    "${methodName}");
  }`
      );
    } else if (methodType === "activityDecision") {
      codeBuffer.push(
      `\n\t${methodName} = async (input: SdkApiTypes.${inputType}, overrideParams?: any): Promise<SdkApiTypes.${responseType}> => {
    return this.activityDecision("${endpointPath}",
    {
      ...{
        parameters: {...input},
        organizationId: this.organizationId,
        timestampMs: String(Date.now()),
        type: "ACTIVITY_TYPE_${operationNameWithoutNamespace.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}"
      }, ...overrideParams
    });
  }`
      );
    }

  }

  // End of the TurnkeySDKClient Class Definition
  codeBuffer.push(`}`);

  await fs.promises.writeFile(
    targetPath,
    [COMMENT_HEADER].concat(imports).concat(codeBuffer).join("\n\n")
  );
}

// Main Runner
main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {

  const swaggerSpecFile = await fs.promises.readFile(PUBLIC_API_SWAGGER_PATH, "utf-8");
  const swaggerSpec = JSON.parse(swaggerSpecFile);

  await generateApiTypesFromSwagger(swaggerSpec, TARGET_API_TYPES_PATH);
  await generateSDKClientFromSwagger(swaggerSpec, TARGET_SDK_CLIENT_PATH);
}
