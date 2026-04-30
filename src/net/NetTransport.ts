import Peer, { DataConnection } from 'peerjs';
import { InputFrame, EMPTY_INPUT } from '../core/Input';

/**
 * Network transport built on PeerJS (WebRTC). The host opens a session and
 * receives a 6-character room code; clients connect with that code.
 *
 * Topology: host-authoritative.
 *   - Clients send `InputMsg` every frame.
 *   - Host runs the simulation and broadcasts `SnapshotMsg` ~30Hz.
 *
 * Why PeerJS? Their public broker handles WebRTC signaling for us, so the
 * game still ships as a static site (GitHub Pages compatible).
 */

export type NetRole = 'solo' | 'host' | 'client';

/** Six-character room code derived from the host's PeerJS id. We register the
 *  host as `awardco-crashers-<CODE>` so codes stay short and human-readable. */
export const ROOM_PREFIX = 'awdco-crashers-';

export interface PeerInfo {
  /** Stable per-session id assigned by host: 1 = host, 2..N = clients in join order. */
  playerSlot: number;
  /** Display name (defaults to "Player N"). */
  name: string;
}

// ---------------- Wire messages ----------------

export type NetMessage =
  | { t: 'hello'; name: string }
  | { t: 'welcome'; slot: number; peers: PeerInfo[] }
  | { t: 'lobby'; peers: PeerInfo[] }
  | { t: 'start' }
  | { t: 'pick'; colorIndex: number } // client -> host: requesting a hero color
  | { t: 'picks'; picks: Record<number, number> } // host -> all: slot -> colorIndex map
  | { t: 'input'; frame: InputFrame; tick: number }
  | { t: 'snap'; tick: number; data: SnapshotPayload }
  | { t: 'event'; kind: string; payload?: unknown };

/** Compact snapshot payload (host -> clients). Kept JSON-serializable so we
 *  can iterate quickly; binary packing is a future optimization. */
export interface SnapshotPayload {
  players: Array<{
    slot: number;
    x: number; y: number; facing: 1 | -1;
    hp: number; lives: number;
    state: string;
    anim?: string;
  }>;
  enemies: Array<{
    id: number; kind: string;
    x: number; y: number; facing: 1 | -1;
    hp: number; maxHp: number;
    state: string;
    anim?: string;
  }>;
  projectiles: Array<{ id: number; x: number; y: number; facing: 1 | -1; kind: string }>;
  boss?: { x: number; y: number; facing: 1 | -1; hp: number; maxHp: number; state: string; anim?: string };
  score: number;
  wave: number;
  remainingEnemies: number;
  totalWaves: number;
  bossPhase: boolean;
  cameraX: number;
}

export type EventHandler = (msg: NetMessage, fromSlot: number) => void;

// ---------------- Transport ----------------

export class NetTransport {
  private peer: Peer | null = null;
  role: NetRole = 'solo';
  /** Local player slot (1=host). */
  selfSlot = 1;
  /** Current room code (host) or the code we joined (client). */
  roomCode = '';
  /** Connections keyed by slot (host: many; client: one). */
  private conns = new Map<number, DataConnection>();
  /** Slot lookup by peerjs connection id (host only). */
  private connSlot = new Map<string, number>();
  private nextSlot = 2;
  peers: PeerInfo[] = [];

  private listeners = new Set<EventHandler>();
  private statusListeners = new Set<(status: string) => void>();

  on(handler: EventHandler): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }
  onStatus(handler: (status: string) => void): () => void {
    this.statusListeners.add(handler);
    return () => this.statusListeners.delete(handler);
  }
  private emit(msg: NetMessage, fromSlot: number): void {
    for (const l of this.listeners) l(msg, fromSlot);
  }
  private status(s: string): void {
    for (const l of this.statusListeners) l(s);
  }

  /** Generate a 6-char human-friendly code (no ambiguous chars). */
  private static generateCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
    return s;
  }

  // -------- Host --------

  async host(name: string): Promise<string> {
    this.role = 'host';
    this.selfSlot = 1;
    this.peers = [{ playerSlot: 1, name }];

    return new Promise((resolve, reject) => {
      const tryOpen = (attempt: number): void => {
        const code = NetTransport.generateCode();
        const peerId = ROOM_PREFIX + code;
        // Recreate Peer for each attempt; PeerJS holds onto the id otherwise.
        try { this.peer?.destroy(); } catch { /* ignore */ }
        this.peer = new Peer(peerId, { debug: 1 });

        this.peer.on('open', () => {
          this.roomCode = code;
          this.status(`Hosting room ${code}`);
          resolve(code);
        });
        this.peer.on('error', (err: Error & { type?: string }) => {
          if (err.type === 'unavailable-id' && attempt < 5) {
            tryOpen(attempt + 1);
          } else if (attempt >= 5) {
            reject(err);
          } else {
            this.status(`Net error: ${err.message}`);
          }
        });
        this.peer.on('connection', (conn) => this.onIncomingConnection(conn));
      };
      tryOpen(0);
    });
  }

  private onIncomingConnection(conn: DataConnection): void {
    const slot = this.nextSlot++;
    this.connSlot.set(conn.peer, slot);
    conn.on('open', () => {
      this.conns.set(slot, conn);
      // Wait for client's 'hello' before adding to lobby
    });
    conn.on('data', (data) => {
      const msg = data as NetMessage;
      if (msg.t === 'hello') {
        const info: PeerInfo = { playerSlot: slot, name: msg.name || `Player ${slot}` };
        this.peers.push(info);
        // Welcome the new client
        conn.send({ t: 'welcome', slot, peers: this.peers } satisfies NetMessage);
        // Update everyone's lobby
        const lobbyMsg: NetMessage = { t: 'lobby', peers: this.peers };
        this.broadcast(lobbyMsg);
        // Tell the host's own UI too
        this.emit(lobbyMsg, 1);
        this.emit(msg, slot);
      } else {
        this.emit(msg, slot);
      }
    });
    conn.on('close', () => {
      this.conns.delete(slot);
      this.peers = this.peers.filter((p) => p.playerSlot !== slot);
      const lobbyMsg: NetMessage = { t: 'lobby', peers: this.peers };
      this.broadcast(lobbyMsg);
      this.emit(lobbyMsg, 1);
      this.status(`Player ${slot} disconnected`);
    });
    conn.on('error', (e) => this.status(`Conn err: ${e.message}`));
  }

  // -------- Client --------

  async join(code: string, name: string): Promise<void> {
    this.role = 'client';
    const cleanCode = code.trim().toUpperCase();
    this.roomCode = cleanCode;

    return new Promise((resolve, reject) => {
      try { this.peer?.destroy(); } catch { /* ignore */ }
      this.peer = new Peer({ debug: 1 });
      this.peer.on('open', () => {
        const conn = this.peer!.connect(ROOM_PREFIX + cleanCode, { reliable: false });
        conn.on('open', () => {
          this.conns.set(1, conn); // host is slot 1
          conn.send({ t: 'hello', name } satisfies NetMessage);
          this.status(`Connected to ${cleanCode}`);
          resolve();
        });
        conn.on('data', (data) => {
          const msg = data as NetMessage;
          if (msg.t === 'welcome') {
            this.selfSlot = msg.slot;
            this.peers = msg.peers;
          } else if (msg.t === 'lobby') {
            this.peers = msg.peers;
          }
          this.emit(msg, 1);
        });
        conn.on('close', () => {
          this.status('Disconnected from host');
        });
        conn.on('error', (e) => this.status(`Conn err: ${e.message}`));
      });
      this.peer.on('error', (err: Error) => {
        this.status(`Net error: ${err.message}`);
        reject(err);
      });
    });
  }

  // -------- Send helpers --------

  /** Host: broadcast to all clients. */
  broadcast(msg: NetMessage): void {
    for (const conn of this.conns.values()) {
      try { conn.send(msg); } catch { /* drop */ }
    }
  }

  /** Client: send to host. */
  sendToHost(msg: NetMessage): void {
    const host = this.conns.get(1);
    if (host) {
      try { host.send(msg); } catch { /* drop */ }
    }
  }

  /** Convenience: client sends an input frame for a tick. */
  sendInput(frame: InputFrame, tick: number): void {
    this.sendToHost({ t: 'input', frame, tick });
  }

  /** Convenience: host sends a snapshot. */
  sendSnapshot(tick: number, data: SnapshotPayload): void {
    this.broadcast({ t: 'snap', tick, data });
  }

  // -------- Tear down --------

  destroy(): void {
    for (const conn of this.conns.values()) try { conn.close(); } catch { /* */ }
    this.conns.clear();
    try { this.peer?.destroy(); } catch { /* */ }
    this.peer = null;
    this.role = 'solo';
    this.peers = [];
  }
}

/** Lazily-created shared transport so all scenes see the same instance. */
let shared: NetTransport | null = null;
export function getNet(): NetTransport {
  if (!shared) shared = new NetTransport();
  return shared;
}

// Suppress unused-warning for default export consumers
export const _unused = EMPTY_INPUT;
