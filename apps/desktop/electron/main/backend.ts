import { parseRpcRequest } from "@survey-synth/contracts";

export const handleBackendCall = async (serializedRequest: string): Promise<unknown> => {
  const request = parseRpcRequest(JSON.parse(serializedRequest) as unknown);

  switch (request.method) {
    case "system.ping":
      return { ok: true, message: "pong" };
    case "session.get":
      return null;
    default:
      throw new Error(`Backend method is not implemented in the Electron v2 shell: ${request.method}`);
  }
};
