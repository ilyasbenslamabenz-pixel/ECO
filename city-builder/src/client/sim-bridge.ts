/**
 * Pont thread principal <-> worker de simulation.
 * - création du worker depuis une URL relative au bundle (repli : Blob) ;
 * - commandes typées avec promesse (résolue sur ok, rejetée sur erreur) ;
 * - diffusion des instantanés / deltas aux abonnés.
 */
import { PROTOCOL_VERSION } from '../shared/constants';
import type { CommandError } from '../shared/contracts';
import type {
  CommandArgs,
  CommandName,
  CommandResult,
  DeltaMessage,
  LogMessage,
  SnapshotMessage,
  WorkerToMain,
} from '../shared/protocol';
import type { ExtCommandArgs, ExtCommandName, ExtCommandResult } from '../sim/sim-protocol';

export class SimCommandError extends Error {
  constructor(public readonly error: CommandError) {
    super(error.message);
    this.name = 'SimCommandError';
  }
}

type Listener<T> = (msg: T) => void;

export class SimBridge {
  private worker: Worker;
  private nextReqId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  private snapshotListeners: Listener<SnapshotMessage>[] = [];
  private deltaListeners: Listener<DeltaMessage>[] = [];
  private logListeners: Listener<LogMessage>[] = [];
  readonly ready: Promise<void>;
  /** Nombre de messages reçus (diagnostic / tests e2e). */
  received = 0;

  private constructor(worker: Worker) {
    this.worker = worker;
    let resolveReady!: () => void;
    let rejectReady!: (e: unknown) => void;
    this.ready = new Promise<void>((res, rej) => { resolveReady = res; rejectReady = rej; });
    worker.onmessage = (ev: MessageEvent<WorkerToMain>) => {
      this.received++;
      const msg = ev.data;
      switch (msg.kind) {
        case 'ready':
          if (msg.protocolVersion !== PROTOCOL_VERSION) rejectReady(new Error('Version de protocole du worker incompatible'));
          else resolveReady();
          break;
        case 'result': {
          const p = this.pending.get(msg.reqId);
          if (!p) break;
          this.pending.delete(msg.reqId);
          if (msg.ok) p.resolve(msg.data);
          else p.reject(new SimCommandError(msg.error));
          break;
        }
        case 'snapshot': for (const l of this.snapshotListeners) l(msg); break;
        case 'delta': for (const l of this.deltaListeners) l(msg); break;
        case 'log': for (const l of this.logListeners) l(msg); break;
      }
    };
    worker.onerror = (ev) => {
      rejectReady(new Error(`Worker de simulation en erreur : ${ev.message}`));
    };
  }

  /** Crée le worker. `workerUrl` est résolue relativement au bundle principal. */
  static async create(workerUrl: URL): Promise<SimBridge> {
    let worker: Worker;
    try {
      worker = new Worker(workerUrl);
    } catch {
      // Repli : certains hébergements interdisent l'URL directe -> Blob same-origin.
      const src = await (await fetch(workerUrl)).text();
      const blobUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      worker = new Worker(blobUrl);
    }
    return new SimBridge(worker);
  }

  send<K extends CommandName>(name: K, args: CommandArgs<K>): Promise<CommandResult<K>> {
    const reqId = this.nextReqId++;
    return new Promise<CommandResult<K>>((resolve, reject) => {
      this.pending.set(reqId, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ kind: 'cmd', reqId, name, args });
    });
  }

  /** Commandes étendues (économie, démographie, LOD de simulation, génération de ville) : mêmes enveloppes. */
  sendExt<K extends ExtCommandName>(name: K, args: ExtCommandArgs<K>): Promise<ExtCommandResult<K>> {
    return this.send(name as never, args as never) as unknown as Promise<ExtCommandResult<K>>;
  }

  onSnapshot(l: Listener<SnapshotMessage>): void { this.snapshotListeners.push(l); }
  onDelta(l: Listener<DeltaMessage>): void { this.deltaListeners.push(l); }
  onLog(l: Listener<LogMessage>): void { this.logListeners.push(l); }

  dispose(): void {
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(new Error('Worker arrêté'));
    this.pending.clear();
  }
}
