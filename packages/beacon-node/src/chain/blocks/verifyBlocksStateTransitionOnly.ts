import {
  CachedBeaconStateAllForks,
  stateTransition,
  ExecutionPayloadStatus,
  DataAvailableStatus,
} from "@lodestar/state-transition";
import {eip4844} from "@lodestar/types";
import {ErrorAborted, ILogger, sleep} from "@lodestar/utils";
import {IChainForkConfig} from "@lodestar/config";
import {IMetrics} from "../../metrics/index.js";
import {BlockError, BlockErrorCode} from "../errors/index.js";
import {BlockProcessOpts} from "../options.js";
import {byteArrayEquals} from "../../util/bytes.js";
import {validateBlobsSidecar} from "../validation/blobsSidecar.js";
import {BlockInput, BlockInputType, ImportBlockOpts} from "./types.js";

/**
 * Verifies 1 or more blocks are fully valid running the full state transition; from a linear sequence of blocks.
 *
 * - Advance state to block's slot - per_slot_processing()
 * - For each block:
 *   - STFN - per_block_processing()
 *   - Check state root matches
 */
export async function verifyBlocksStateTransitionOnly(
  preState0: CachedBeaconStateAllForks,
  blocks: BlockInput[],
  logger: ILogger,
  metrics: IMetrics | null,
  signal: AbortSignal,
  opts: BlockProcessOpts & ImportBlockOpts
): Promise<{postStates: CachedBeaconStateAllForks[]; proposerBalanceDeltas: number[]}> {
  const {config} = preState0;
  const postStates: CachedBeaconStateAllForks[] = [];
  const proposerBalanceDeltas: number[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const {validProposerSignature, validSignatures, disabledWithdrawals} = opts;
    const {block} = blocks[i];
    const preState = i === 0 ? preState0 : postStates[i - 1];

    // TODO EIP-4844: Is the best place here to call validateBlobsSidecar()?
    // TODO EIP-4844: Gossip may already call validateBlobsSidecar, add some flag to de-dup from here
    // TODO EIP-4844: For sync if this function is expensive, consider adding sleep(0) if metrics show it
    const dataAvailableStatus = maybeValidateBlobs(config, blocks[i], opts);

    // STFN - per_slot_processing() + per_block_processing()
    // NOTE: `regen.getPreState()` should have dialed forward the state already caching checkpoint states
    const useBlsBatchVerify = !opts?.disableBlsBatchVerify;
    const postState = stateTransition(
      preState,
      block,
      {
        // NOTE: Assume valid for now while sending payload to execution engine in parallel
        // Latter verifyBlocksInEpoch() will make sure that payload is indeed valid
        executionPayloadStatus: ExecutionPayloadStatus.valid,
        // TODO EIP-4844: Data is validated above for
        dataAvailableStatus,
        // false because it's verified below with better error typing
        verifyStateRoot: false,
        // if block is trusted don't verify proposer or op signature
        verifyProposer: !useBlsBatchVerify && !validSignatures && !validProposerSignature,
        verifySignatures: !useBlsBatchVerify && !validSignatures,
        disabledWithdrawals,
      },
      metrics
    );

    // Check state root matches
    if (!byteArrayEquals(block.message.stateRoot, postState.hashTreeRoot())) {
      throw new BlockError(block, {
        code: BlockErrorCode.INVALID_STATE_ROOT,
        root: postState.hashTreeRoot(),
        expectedRoot: block.message.stateRoot,
        preState,
        postState,
      });
    }

    postStates[i] = postState;

    // For metric block profitability
    const proposerIndex = block.message.proposerIndex;
    proposerBalanceDeltas[i] = postState.balances.get(proposerIndex) - preState.balances.get(proposerIndex);

    // If blocks are invalid in execution the main promise could resolve before this loop ends.
    // In that case stop processing blocks and return early.
    if (signal.aborted) {
      throw new ErrorAborted("verifyBlockStateTransitionOnly");
    }

    // this avoids keeping our node busy processing blocks
    if (i < blocks.length - 1) {
      await sleep(0);
    }
  }

  if (blocks.length === 1 && opts.seenTimestampSec !== undefined) {
    const slot = blocks[0].block.message.slot;
    const recvToTransition = Date.now() / 1000 - opts.seenTimestampSec;
    metrics?.gossipBlock.receivedToStateTransition.observe(recvToTransition);
    logger.verbose("Transitioned gossip block", {slot, recvToTransition});
  }

  return {postStates, proposerBalanceDeltas};
}

function maybeValidateBlobs(
  config: IChainForkConfig,
  blockInput: BlockInput,
  opts: ImportBlockOpts
): DataAvailableStatus {
  // TODO EIP4844: Make switch verify it's exhaustive
  switch (blockInput.type) {
    case BlockInputType.postEIP4844: {
      if (opts.validBlobsSidecar) {
        return DataAvailableStatus.available;
      }

      const {block, blobs} = blockInput;
      const blockSlot = block.message.slot;
      const {blobKzgCommitments} = (block as eip4844.SignedBeaconBlock).message.body;
      const beaconBlockRoot = config.getForkTypes(blockSlot).BeaconBlock.hashTreeRoot(block.message);
      // TODO EIP-4844: This function throws un-typed errors
      validateBlobsSidecar(blockSlot, beaconBlockRoot, blobKzgCommitments, blobs);

      return DataAvailableStatus.available;
    }

    case BlockInputType.preEIP4844:
      return DataAvailableStatus.preEIP4844;

    // TODO: Ok to assume old data available?
    case BlockInputType.postEIP4844OldBlobs:
      return DataAvailableStatus.available;
  }
}
