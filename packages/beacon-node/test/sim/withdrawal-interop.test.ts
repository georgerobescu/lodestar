import fs from "node:fs";
import {Context} from "mocha";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {LogLevel, sleep, TimestampFormatCode} from "@lodestar/utils";
import {SLOTS_PER_EPOCH, ForkName} from "@lodestar/params";
import {IChainConfig} from "@lodestar/config";
import {Epoch, capella} from "@lodestar/types";
import {ValidatorProposerConfig} from "@lodestar/validator";

import {ExecutePayloadStatus, PayloadAttributes} from "../../src/execution/engine/interface.js";
import {initializeExecutionEngine} from "../../src/execution/index.js";
import {ChainEvent} from "../../src/chain/index.js";
import {testLogger, TestLoggerOpts} from "../utils/logger.js";
import {getDevBeaconNode} from "../utils/node/beacon.js";
import {BeaconRestApiServerOpts} from "../../src/api/index.js";
import {simTestInfoTracker} from "../utils/node/simTest.js";
import {getAndInitDevValidators} from "../utils/node/validator.js";
import {Eth1Provider} from "../../src/index.js";
import {ZERO_HASH} from "../../src/constants/index.js";
import {bytesToData, dataToBytes} from "../../src/eth1/provider/utils.js";
import {defaultExecutionEngineHttpOpts} from "../../src/execution/engine/http.js";
import {runEL, ELStartMode, ELClient} from "../utils/runEl.js";
import {logFilesDir} from "./params.js";
import {shell} from "./shell.js";

// NOTE: How to run
// EL_BINARY_DIR=g11tech/geth:withdrawals EL_SCRIPT_DIR=gethdocker yarn mocha test/sim/withdrawal-interop.test.ts
// ```

/* eslint-disable no-console, @typescript-eslint/naming-convention, quotes */

const jwtSecretHex = "0xdc6457099f127cf0bac78de8b297df04951281909db4f58b43def7c7151e765d";
const retryAttempts = defaultExecutionEngineHttpOpts.retryAttempts;
const retryDelay = defaultExecutionEngineHttpOpts.retryDelay;
const GWEI_TO_WEI = BigInt(1000000000);

describe("executionEngine / ExecutionEngineHttp", function () {
  if (!process.env.EL_BINARY_DIR || !process.env.EL_SCRIPT_DIR) {
    throw Error(
      `EL ENV must be provided, EL_BINARY_DIR: ${process.env.EL_BINARY_DIR}, EL_SCRIPT_DIR: ${process.env.EL_SCRIPT_DIR}`
    );
  }
  this.timeout("10min");

  const dataPath = fs.mkdtempSync("lodestar-test-withdrawal");
  const elSetupConfig = {
    elScriptDir: process.env.EL_SCRIPT_DIR,
    elBinaryDir: process.env.EL_BINARY_DIR,
  };
  const elRunOptions = {
    dataPath,
    jwtSecretHex,
    enginePort: parseInt(process.env.ENGINE_PORT ?? "8551"),
    ethPort: parseInt(process.env.ETH_PORT ?? "8545"),
  };

  const controller = new AbortController();
  after(async () => {
    controller?.abort();
    await shell(`sudo rm -rf ${dataPath}`);
  });

  const afterEachCallbacks: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  it("Send stub payloads to EL", async () => {
    const {elClient, tearDownCallBack} = await runEL(
      {...elSetupConfig, mode: ELStartMode.PostMerge, genesisTemplate: "genesisPostWithdraw.tmpl"},
      {...elRunOptions, ttd: BigInt(0)},
      controller.signal
    );
    afterEachCallbacks.push(() => tearDownCallBack());
    const {genesisBlockHash, engineRpcUrl} = elClient;
    console.log({genesisBlockHash});

    //const controller = new AbortController();
    const executionEngine = initializeExecutionEngine(
      {mode: "http", urls: [engineRpcUrl], jwtSecretHex, retryAttempts, retryDelay},
      {signal: controller.signal}
    );

    const withdrawalsVector = [
      {Index: 0, Validator: 65535, Recipient: "0x0000000000000000000000000000000000000000", Amount: "0"},
      {
        Index: 1,
        Validator: 65536,
        Recipient: "0x0100000000000000000000000000000000000000",
        Amount: "452312848583266388373324160190187140051835877600158453279131187530910662656",
      },
      {
        Index: 2,
        Validator: 65537,
        Recipient: "0x0200000000000000000000000000000000000000",
        Amount: "904625697166532776746648320380374280103671755200316906558262375061821325312",
      },
      {
        Index: 3,
        Validator: 65538,
        Recipient: "0x0300000000000000000000000000000000000000",
        Amount: "1356938545749799165119972480570561420155507632800475359837393562592731987968",
      },
      {
        Index: 4,
        Validator: 65539,
        Recipient: "0x0400000000000000000000000000000000000000",
        Amount: "1809251394333065553493296640760748560207343510400633813116524750123642650624",
      },
      {
        Index: 5,
        Validator: 65540,
        Recipient: "0x0500000000000000000000000000000000000000",
        Amount: "2261564242916331941866620800950935700259179388000792266395655937654553313280",
      },
      {
        Index: 6,
        Validator: 65541,
        Recipient: "0x0600000000000000000000000000000000000000",
        Amount: "2713877091499598330239944961141122840311015265600950719674787125185463975936",
      },
      {
        Index: 7,
        Validator: 65542,
        Recipient: "0x0700000000000000000000000000000000000000",
        Amount: "3166189940082864718613269121331309980362851143201109172953918312716374638592",
      },
    ];

    const withdrawals = withdrawalsVector.map((testVec) => ({
      index: testVec.Index,
      validatorIndex: testVec.Validator,
      address: dataToBytes(testVec.Recipient, 20),
      amount: BigInt(testVec.Amount) / GWEI_TO_WEI,
    }));

    const preparePayloadParams: PayloadAttributes = {
      // Note: this is created with a pre-defined genesis.json
      timestamp: 47,
      prevRandao: dataToBytes("0xff00000000000000000000000000000000000000000000000000000000000000", 32),
      suggestedFeeRecipient: "0xaa00000000000000000000000000000000000000",
      withdrawals,
    };
    const finalizedBlockHash = "0xfe950635b1bd2a416ff6283b0bbd30176e1b1125ad06fa729da9f3f4c1c61710";

    // 1. Prepare a payload
    const payloadId = await executionEngine.notifyForkchoiceUpdate(
      ForkName.capella,
      genesisBlockHash,
      //use finalizedBlockHash as safeBlockHash
      finalizedBlockHash,
      finalizedBlockHash,
      preparePayloadParams
    );
    if (!payloadId) throw Error("InvalidPayloadId");

    // 2. Get the payload
    const payload = await executionEngine.getPayload(ForkName.capella, payloadId);
    const blockHash = toHexString(payload.blockHash);
    const expectedBlockHash = "0x64707e5574d14103a7f583e702f09e68ca1eb334e8eb0632a4272efe54f2fc7c";
    if (blockHash !== expectedBlockHash) {
      throw Error(`Invalid blockHash expected=${expectedBlockHash} actual=${blockHash}`);
    }

    // 3. Execute the payload
    const payloadResult = await executionEngine.notifyNewPayload(ForkName.capella, payload);
    if (payloadResult.status !== ExecutePayloadStatus.VALID) {
      throw Error("getPayload returned payload that notifyNewPayload deems invalid");
    }

    // 4. Update the fork choice
    await executionEngine.notifyForkchoiceUpdate(
      ForkName.capella,
      bytesToData(payload.blockHash),
      genesisBlockHash,
      genesisBlockHash
    );
  });

  it("Post-merge, run for a few blocks", async function () {
    console.log("\n\nPost-merge, run for a few blocks\n\n");
    const {elClient, tearDownCallBack} = await runEL(
      {...elSetupConfig, mode: ELStartMode.PostMerge, genesisTemplate: "genesisPostWithdraw.tmpl"},
      {...elRunOptions, ttd: BigInt(0)},
      controller.signal
    );
    afterEachCallbacks.push(() => tearDownCallBack());

    await runNodeWithEL.bind(this)({
      elClient,
      capellaEpoch: 0,
      testName: "post-merge",
    });
  });

  async function runNodeWithEL(
    this: Context,
    {elClient, capellaEpoch, testName}: {elClient: ELClient; capellaEpoch: Epoch; testName: string}
  ): Promise<void> {
    const {genesisBlockHash, ttd, engineRpcUrl} = elClient;
    const validatorClientCount = 1;
    const validatorsPerClient = 32;

    const testParams: Pick<IChainConfig, "SECONDS_PER_SLOT"> = {
      SECONDS_PER_SLOT: 2,
    };

    // Just finish the run within first epoch as we only need to test if withdrawals started
    const expectedEpochsToFinish = 1;
    // 1 epoch of margin of error
    const epochsOfMargin = 1;
    const timeoutSetupMargin = 30 * 1000; // Give extra 30 seconds of margin

    // delay a bit so regular sync sees it's up to date and sync is completed from the beginning
    const genesisSlotsDelay = 8;

    const timeout =
      ((epochsOfMargin + expectedEpochsToFinish) * SLOTS_PER_EPOCH + genesisSlotsDelay) *
      testParams.SECONDS_PER_SLOT *
      1000;

    this.timeout(timeout + 2 * timeoutSetupMargin);

    const genesisTime = Math.floor(Date.now() / 1000) + genesisSlotsDelay * testParams.SECONDS_PER_SLOT;

    const testLoggerOpts: TestLoggerOpts = {
      logLevel: LogLevel.info,
      logFile: `${logFilesDir}/mergemock-${testName}.log`,
      timestampFormat: {
        format: TimestampFormatCode.EpochSlot,
        genesisTime,
        slotsPerEpoch: SLOTS_PER_EPOCH,
        secondsPerSlot: testParams.SECONDS_PER_SLOT,
      },
    };
    const loggerNodeA = testLogger("Node-A", testLoggerOpts);

    const bn = await getDevBeaconNode({
      params: {
        ...testParams,
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: capellaEpoch,
        TERMINAL_TOTAL_DIFFICULTY: ttd,
      },
      options: {
        api: {rest: {enabled: true} as BeaconRestApiServerOpts},
        sync: {isSingleNode: true},
        network: {allowPublishToZeroPeers: true, discv5: null},
        // Now eth deposit/merge tracker methods directly available on engine endpoints
        eth1: {enabled: false, providerUrls: [engineRpcUrl], jwtSecretHex},
        executionEngine: {urls: [engineRpcUrl], jwtSecretHex},
        chain: {suggestedFeeRecipient: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},
      },
      validatorCount: validatorClientCount * validatorsPerClient,
      logger: loggerNodeA,
      genesisTime,
      eth1BlockHash: fromHexString(genesisBlockHash),
      withEth1Credentials: true,
    });

    afterEachCallbacks.push(async function () {
      await bn.close();
      await sleep(1000);
    });

    const stopInfoTracker = simTestInfoTracker(bn, loggerNodeA);
    const valProposerConfig = {
      defaultConfig: {
        feeRecipient: "0xcccccccccccccccccccccccccccccccccccccccc",
      },
    } as ValidatorProposerConfig;

    const {validators} = await getAndInitDevValidators({
      node: bn,
      validatorsPerClient,
      validatorClientCount,
      startIndex: 0,
      // At least one sim test must use the REST API for beacon <-> validator comms
      useRestApi: true,
      testLoggerOpts,
      valProposerConfig,
    });

    afterEachCallbacks.push(async function () {
      await Promise.all(validators.map((v) => v.close()));
    });

    let withdrawalsStarted = false;
    let withdrawalsBlocks = 0;

    await new Promise<void>((resolve, _reject) => {
      bn.chain.emitter.on(ChainEvent.clockEpoch, (epoch) => {
        // Resolve only if the finalized checkpoint includes execution payload
        if (epoch >= expectedEpochsToFinish) {
          console.log(`\nGot event ${ChainEvent.clockEpoch}, stopping validators and nodes\n`);
          resolve();
        }
      });

      bn.chain.emitter.on(ChainEvent.block, (block) => {
        if ((block as capella.SignedBeaconBlock).message.body.executionPayload?.withdrawals.length > 0) {
          withdrawalsStarted = true;
          withdrawalsBlocks++;
        }
      });
    });

    // Stop chain and un-subscribe events so the execution engine won't update it's head
    // Allow some time to broadcast finalized events and complete the importBlock routine
    await Promise.all(validators.map((v) => v.close()));
    await bn.close();
    await sleep(500);

    if (bn.chain.beaconProposerCache.get(1) !== "0xcccccccccccccccccccccccccccccccccccccccc") {
      throw Error("Invalid feeRecipient set at BN");
    }

    // Assertions to make sure the end state is good
    // 1. The proper head is set
    const rpc = new Eth1Provider({DEPOSIT_CONTRACT_ADDRESS: ZERO_HASH}, {providerUrls: [engineRpcUrl], jwtSecretHex});
    const consensusHead = bn.chain.forkChoice.getHead();
    const executionHeadBlock = await rpc.getBlockByNumber("latest");

    if (!executionHeadBlock) throw Error("Execution has not head block");
    if (consensusHead.executionPayloadBlockHash !== executionHeadBlock.hash) {
      throw Error(
        "Consensus head not equal to execution head: " +
          JSON.stringify({
            executionHeadBlockHash: executionHeadBlock.hash,
            consensusHeadExecutionPayloadBlockHash: consensusHead.executionPayloadBlockHash,
            consensusHeadSlot: consensusHead.slot,
          })
      );
    }

    // Simple check to confirm that withdrawals were mostly processed
    if (!withdrawalsStarted || withdrawalsBlocks < 4) {
      throw Error(
        `Withdrawals not processed withdrawalsStarted=${withdrawalsStarted} withdrawalsBlocks=${withdrawalsBlocks}`
      );
    }

    // wait for 1 slot to print current epoch stats
    await sleep(1 * bn.config.SECONDS_PER_SLOT * 1000);
    stopInfoTracker();
    console.log("\n\nDone\n\n");
  }
});
