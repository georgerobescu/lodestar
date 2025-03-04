import type {PublicKey} from "@chainsafe/bls/types";
import {IBeaconConfig} from "@lodestar/config";
import {altair, phase0, SyncPeriod} from "@lodestar/types";
import {computeSyncPeriodAtSlot, deserializeSyncCommittee} from "../utils/index.js";
import {LightClientUpdateSummary} from "./isBetterUpdate.js";

export const MAX_SYNC_PERIODS_CACHE = 2;

export interface ILightClientStore {
  readonly config: IBeaconConfig;

  /** Map of trusted SyncCommittee to be used for sig validation */
  readonly syncCommittees: Map<SyncPeriod, SyncCommitteeFast>;
  /** Map of best valid updates */
  readonly bestValidUpdates: Map<SyncPeriod, LightClientUpdateWithSummary>;

  getMaxActiveParticipants(period: SyncPeriod): number;
  setActiveParticipants(period: SyncPeriod, activeParticipants: number): void;

  // Header that is finalized
  finalizedHeader: phase0.BeaconBlockHeader;

  // Most recent available reasonably-safe header
  optimisticHeader: phase0.BeaconBlockHeader;
}

export interface LightClientStoreEvents {
  onSetFinalizedHeader?: (header: phase0.BeaconBlockHeader) => void;
  onSetOptimisticHeader?: (header: phase0.BeaconBlockHeader) => void;
}

export class LightClientStore implements ILightClientStore {
  readonly syncCommittees = new Map<SyncPeriod, SyncCommitteeFast>();
  readonly bestValidUpdates = new Map<SyncPeriod, LightClientUpdateWithSummary>();

  private _finalizedHeader: phase0.BeaconBlockHeader;
  private _optimisticHeader: phase0.BeaconBlockHeader;

  private readonly maxActiveParticipants = new Map<SyncPeriod, number>();

  constructor(
    readonly config: IBeaconConfig,
    bootstrap: altair.LightClientBootstrap,
    private readonly events: LightClientStoreEvents
  ) {
    const bootstrapPeriod = computeSyncPeriodAtSlot(bootstrap.header.slot);
    this.syncCommittees.set(bootstrapPeriod, deserializeSyncCommittee(bootstrap.currentSyncCommittee));
    this._finalizedHeader = bootstrap.header;
    this._optimisticHeader = bootstrap.header;
  }

  get finalizedHeader(): phase0.BeaconBlockHeader {
    return this._finalizedHeader;
  }

  set finalizedHeader(value: phase0.BeaconBlockHeader) {
    this._finalizedHeader = value;
    this.events.onSetFinalizedHeader?.(value);
  }

  get optimisticHeader(): phase0.BeaconBlockHeader {
    return this._optimisticHeader;
  }

  set optimisticHeader(value: phase0.BeaconBlockHeader) {
    this._optimisticHeader = value;
    this.events.onSetOptimisticHeader?.(value);
  }

  getMaxActiveParticipants(period: SyncPeriod): number {
    const currMaxParticipants = this.maxActiveParticipants.get(period) ?? 0;
    const prevMaxParticipants = this.maxActiveParticipants.get(period - 1) ?? 0;

    return Math.max(currMaxParticipants, prevMaxParticipants);
  }

  setActiveParticipants(period: SyncPeriod, activeParticipants: number): void {
    const maxActiveParticipants = this.maxActiveParticipants.get(period) ?? 0;
    if (activeParticipants > maxActiveParticipants) {
      this.maxActiveParticipants.set(period, activeParticipants);
    }

    // Prune old entries
    for (const key of this.maxActiveParticipants.keys()) {
      if (key < period - MAX_SYNC_PERIODS_CACHE) {
        this.maxActiveParticipants.delete(key);
      }
    }
  }
}

export type SyncCommitteeFast = {
  pubkeys: PublicKey[];
  aggregatePubkey: PublicKey;
};

export type LightClientUpdateWithSummary = {
  update: altair.LightClientUpdate;
  summary: LightClientUpdateSummary;
};

// === storePeriod ? store.currentSyncCommittee : store.nextSyncCommittee;
// if (!syncCommittee) {
//   throw Error(`syncCommittee not available for signature period ${updateSignaturePeriod}`);
// }
