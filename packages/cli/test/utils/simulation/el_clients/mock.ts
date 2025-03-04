/* eslint-disable @typescript-eslint/naming-convention */
import {ELClient, ELClientGenerator, ELGeneratorClientOptions, ELNode, Runner, RunnerType} from "../interfaces.js";

export const generateMockNode: ELClientGenerator<ELClient.Mock> = (
  {id, ethPort, enginePort, ttd, jwtSecretHex}: ELGeneratorClientOptions,
  runner: Runner<RunnerType.ChildProcess> | Runner<RunnerType.Docker>
) => {
  const ethRpcUrl = `http://127.0.0.1:${ethPort}`;
  const engineRpcUrl = `http://127.0.0.1:${enginePort}`;

  const job = runner.create(id, []);

  const node: ELNode = {
    client: ELClient.Mock,
    id,
    engineRpcUrl,
    ethRpcUrl,
    ttd,
    jwtSecretHex,
    provider: null,
  };

  return {job, node};
};
