import {config} from "@chainsafe/lodestar-config/minimal";
import {urlJoin} from "@chainsafe/lodestar-validator/src/util";
import {expect} from "chai";
import supertest from "supertest";
import {CONFIG_PREFIX, setupRestApiTestServer} from "../index.test";
import {getDepositContract} from "../../../../../src/api/rest/controllers/config";
import {ConfigApi} from "../../../../../lib/api/impl/config";
import {SinonStubbedInstance} from "sinon";

describe("rest - config - getDepositContract", function () {
  it("ready", async function () {
    const restApi = await setupRestApiTestServer();
    const configStub = restApi.server.api.config as SinonStubbedInstance<ConfigApi>;
    const depositContract = {
      chainId: config.params.DEPOSIT_CHAIN_ID,
      address: config.params.DEPOSIT_CONTRACT_ADDRESS,
    };
    const expectedJson = config.types.phase0.Contract.toJson(depositContract, {case: "snake"}) as Record<
      string,
      unknown
    >;
    configStub.getDepositContract.resolves(depositContract);
    const response = await supertest(restApi.server.server)
      .get(urlJoin(CONFIG_PREFIX, getDepositContract.url))
      .expect(200);
    expect(response.body.data).to.not.be.undefined;
    expect(Object.keys(response.body.data).length).to.equal(2);
    expect(response.body.data.chain_id).to.equal(Object.values(expectedJson)[0]);
    expect(response.body.data.address).to.equal(Object.values(expectedJson)[1]);
  });
});
