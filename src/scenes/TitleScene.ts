import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../core/constants';
import { getNet, NetMessage } from '../net/NetTransport';

const HERO_NAMES = ['RED', 'BLUE', 'GREEN', 'YELLOW'];
const HERO_COLORS = [0xff5a4e, 0x4ea0ff, 0x5ed16a, 0xffc94e];
const HERO_COLORS_HEX = ['#ff5a4e', '#4ea0ff', '#5ed16a', '#ffc94e'];

/**
 * Title + Lobby scene. Three modes:
 *   - Solo: jump straight into Game (legacy behavior).
 *   - Host: open a room, show 6-char code, wait for clients, press START.
 *   - Join: prompt for code via DOM input, connect, wait for host start.
 *
 * On 'start' from host (or solo), we transition to Game with mode in registry.
 */
export class TitleScene extends Phaser.Scene {
  private statusText!: Phaser.GameObjects.Text;
  private codeText!: Phaser.GameObjects.Text;
  private peerListText!: Phaser.GameObjects.Text;
  private offNet?: () => void;
  private offStatus?: () => void;
  private offHostPick?: () => void;
  private mode: 'menu' | 'host' | 'join' | 'soloPending' = 'menu';
  /** slot -> colorIndex map (authoritative copy held by host; clients see broadcast). */
  private picks: Record<number, number> = {};
  private pickTiles: Phaser.GameObjects.Container | null = null;

  constructor() { super('Title'); }

  create(): void {
    this.cameras.main.setBackgroundColor('#0e1422');
    const cx = GAME_WIDTH / 2;

    this.add.text(cx, 60, 'AWARDCO CRASHERS', {
      fontFamily: 'Impact, "Arial Black"', fontSize: '52px', color: '#ffd34a',
      stroke: '#000', strokeThickness: 6
    }).setOrigin(0.5);

    this.add.text(cx, 110, 'a four-player corporate beat-em-up', {
      fontFamily: 'Arial', fontSize: '16px', color: '#cfd6e4'
    }).setOrigin(0.5);

    this.statusText = this.add.text(cx, GAME_HEIGHT - 24, '', {
      fontFamily: 'monospace', fontSize: '12px', color: '#8aa0b8'
    }).setOrigin(0.5);

    const net = getNet();
    this.offStatus = net.onStatus((s) => { this.statusText.setText(s); });
    this.offNet = net.on((m) => this.handleNet(m));

    // Auto-join via ?room=ABC123 URL parameter
    const params = new URLSearchParams(window.location.search);
    const roomParam = (params.get('room') ?? '').trim().toUpperCase();
    if (roomParam.length === 6) {
      this.beginJoinWithCode(roomParam);
    } else {
      this.showMenu();
    }
  }

  private clearScreen(): void {
    // Destroy any non-permanent children below header
    for (const c of [...this.children.list]) {
      if (c instanceof Phaser.GameObjects.Text) {
        const t = c as Phaser.GameObjects.Text;
        if (t.y >= 150 && t !== this.statusText) t.destroy();
      } else if ((c as Phaser.GameObjects.Rectangle).type === 'Rectangle') {
        c.destroy();
      } else if (c === this.pickTiles) {
        c.destroy();
      }
    }
    this.pickTiles = null;
    this.codeText = undefined as unknown as Phaser.GameObjects.Text;
    this.peerListText = undefined as unknown as Phaser.GameObjects.Text;
  }  private showMenu(): void {
    this.mode = 'menu';
    this.clearScreen();
    const cx = GAME_WIDTH / 2;
    this.makeButton(cx, 220, 'SOLO', () => this.startSolo());
    this.makeButton(cx, 280, 'HOST GAME', () => this.beginHost());
    this.makeButton(cx, 340, 'JOIN GAME', () => this.beginJoin());

    this.add.text(cx, 410, 'WASD move · Space jump · Shift block', {
      fontFamily: 'Arial', fontSize: '12px', color: '#7d8aa1'
    }).setOrigin(0.5);
    this.add.text(cx, 428, 'J ranged · K heavy · L special', {
      fontFamily: 'Arial', fontSize: '12px', color: '#7d8aa1'
    }).setOrigin(0.5);
  }

  private makeButton(x: number, y: number, label: string, onClick: () => void): Phaser.GameObjects.Text {
    const btn = this.add.text(x, y, label, {
      fontFamily: 'Impact', fontSize: '28px', color: '#ffffff',
      backgroundColor: '#2a3346', padding: { left: 18, right: 18, top: 8, bottom: 8 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    btn.on('pointerover', () => btn.setStyle({ backgroundColor: '#3d4a66' }));
    btn.on('pointerout', () => btn.setStyle({ backgroundColor: '#2a3346' }));
    btn.on('pointerdown', onClick);
    return btn;
  }

  // ----- Solo -----

  private startSolo(): void {
    this.mode = 'soloPending';
    this.game.registry.set('netRole', 'solo');
    this.game.registry.set('netSlot', 1);
    this.cleanupNet();
    this.scene.start('Game');
  }

  // ----- Host -----

  private async beginHost(): Promise<void> {
    const name = await this.promptName('host');
    if (!name) { this.showMenu(); return; }
    this.mode = 'host';
    this.clearScreen();
    const cx = GAME_WIDTH / 2;
    let y = 160;
    this.add.text(cx, y, 'HOSTING…', {
      fontFamily: 'Impact', fontSize: '22px', color: '#ffd34a'
    }).setOrigin(0.5);
    y += 40;
    this.codeText = this.add.text(cx, y, '------', {
      fontFamily: 'monospace', fontSize: '54px', color: '#ffffff', stroke: '#000', strokeThickness: 4
    }).setOrigin(0.5);
    y += 54;
    this.add.text(cx, y, 'share this code with friends', {
      fontFamily: 'Arial', fontSize: '12px', color: '#8aa0b8'
    }).setOrigin(0.5);
    y += 24;
    // Copy link button below code
    try {
      const code = await getNet().host(name);
      this.codeText.setText(code);
      this.makeButton(cx, y, 'COPY LINK', () => this.copyJoinLink(code))
        .setStyle({ fontSize: '14px', backgroundColor: '#2a3346' });
      y += 36;
      // Host claims slot 1 = RED (index 0) by default; allow re-pick.
      this.picks = { 1: 0 };
      this.broadcastPicks();
    } catch (e) {
      this.codeText.setText('FAILED');
      this.statusText.setText(`Host failed: ${(e as Error).message}`);
    }
    // Player list
    this.peerListText = this.add.text(cx, y, 'Players:\n  1. ' + name + ' (you)', {
      fontFamily: 'monospace', fontSize: '14px', color: '#cfd6e4', align: 'center'
    }).setOrigin(0.5, 0);
    y += 60;
    // Color picker below player list
    this.buildPickTiles(cx, y);
    // Host: route incoming 'pick' messages by sender slot.
    this.offHostPick?.();
    this.offHostPick = getNet().on((m, fromSlot) => {
      if (m.t === 'pick' && getNet().role === 'host') {
        this.applyPickRequest(fromSlot, m.colorIndex);
      }
    });
    // Place buttons side by side below color picker, not overlapping
    const btnY = Math.min(GAME_HEIGHT - 60, y + 120);
    const btnW = 160;
    const btnGap = 32;
    this.makeButton(cx - btnW / 2 - btnGap / 2, btnY, 'START GAME', () => this.hostStart())
      .setStyle({ fontSize: '20px', backgroundColor: '#2a3346', padding: { left: 12, right: 12, top: 6, bottom: 6 } });
    this.makeButton(cx + btnW / 2 + btnGap / 2, btnY, 'BACK', () => { this.cleanupNet(); this.showMenu(); })
      .setStyle({ fontSize: '20px', backgroundColor: '#3a2a2a', padding: { left: 12, right: 12, top: 6, bottom: 6 } });
  }

  private hostStart(): void {
    const net = getNet();
    net.broadcast({ t: 'start' });
    this.handleStart();
  }

  // ----- Join -----

  private async beginJoin(): Promise<void> {
    const code = (await this.promptText('Enter room code:', '', 6)).trim().toUpperCase();
    if (!code) { this.showMenu(); return; }
    return this.beginJoinWithCode(code);
  }

  private async beginJoinWithCode(code: string): Promise<void> {
    const name = await this.promptName('client');
    if (!name) { this.showMenu(); return; }
    this.mode = 'join';
    this.clearScreen();
    const cx = GAME_WIDTH / 2;

    let y = 160;
    this.add.text(cx, y, 'JOINING ' + code + '…', {
      fontFamily: 'Impact', fontSize: '22px', color: '#ffd34a'
    }).setOrigin(0.5);
    y += 40;
    this.peerListText = this.add.text(cx, y, 'Connecting…', {
      fontFamily: 'monospace', fontSize: '14px', color: '#cfd6e4', align: 'center'
    }).setOrigin(0.5, 0);
    y += 60;
    try {
      await getNet().join(code, name);
      this.peerListText.setText('Connected. Pick your hero, then wait for host to start…');
    } catch (e) {
      this.peerListText.setText(`Failed: ${(e as Error).message}`);
    }
    // Color picker below player list
    this.buildPickTiles(cx, y);
    // Only BACK button for join, below color picker
    const btnY = Math.min(GAME_HEIGHT - 60, y + 120);
    this.makeButton(cx, btnY, 'BACK', () => { this.cleanupNet(); this.showMenu(); })
      .setStyle({ fontSize: '20px', backgroundColor: '#3a2a2a', padding: { left: 12, right: 12, top: 6, bottom: 6 } });
  }

  // ----- Net events -----

  private handleNet(msg: NetMessage): void {
    if (msg.t === 'lobby' || msg.t === 'welcome') {
      this.refreshPeerList();
      this.refreshPickTiles();
    } else if (msg.t === 'start') {
      this.handleStart();
    } else if (msg.t === 'picks') {
      this.picks = { ...msg.picks };
      this.refreshPickTiles();
    }
  }

  private refreshPeerList(): void {
    if (!this.peerListText) return;
    const net = getNet();
    const lines = ['Players:'];
    for (const p of net.peers) {
      const youMark = p.playerSlot === net.selfSlot ? ' (you)' : '';
      const hostMark = p.playerSlot === 1 ? ' [HOST]' : '';
      lines.push(`  ${p.playerSlot}. ${p.name}${youMark}${hostMark}`);
    }
    this.peerListText.setText(lines.join('\n'));
  }

  private handleStart(): void {
    const net = getNet();
    this.game.registry.set('netRole', net.role);
    this.game.registry.set('netSlot', net.selfSlot);
    this.game.registry.set('netPeers', net.peers);
    this.game.registry.set('netPicks', this.picks);
    if (net.role === 'client') {
      this.scene.start('Client');
    } else {
      this.scene.start('Game');
    }
  }

  private async promptName(role: 'host' | 'client'): Promise<string> {
    const stored = window.localStorage.getItem('awdco-name');
    if (stored) return stored;
    const def = role === 'host' ? 'Host' : 'Player';
    const name = (await this.promptText('Your name:', def, 16)).slice(0, 16) || def;
    try { window.localStorage.setItem('awdco-name', name); } catch { /* ignore */ }
    return name;
  }

  /**
   * Show an HTML <input> overlaid on the canvas. Resolves with the entered
   * value (or '' on cancel). Used because window.prompt is blocked in the
   * VS Code embedded browser and is generally bad UX.
   */
  private promptText(label: string, defaultValue: string, maxLength: number): Promise<string> {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:9999;font-family:Arial,sans-serif;`;
      const card = document.createElement('div');
      card.style.cssText = `background:#1d2330;color:#fff;padding:24px;border-radius:8px;min-width:280px;box-shadow:0 8px 32px rgba(0,0,0,0.6);`;
      const lbl = document.createElement('div');
      lbl.textContent = label;
      lbl.style.cssText = `margin-bottom:12px;font-size:14px;color:#cfd6e4;`;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = defaultValue;
      input.maxLength = maxLength;
      input.style.cssText = `width:100%;padding:8px 10px;font-size:18px;border:2px solid #ffd34a;background:#0e1422;color:#fff;border-radius:4px;box-sizing:border-box;text-transform:none;`;
      const btnRow = document.createElement('div');
      btnRow.style.cssText = `margin-top:16px;display:flex;gap:8px;justify-content:flex-end;`;
      const cancel = document.createElement('button');
      cancel.textContent = 'Cancel';
      cancel.style.cssText = `padding:6px 14px;background:#3a2a2a;color:#fff;border:0;border-radius:4px;cursor:pointer;`;
      const ok = document.createElement('button');
      ok.textContent = 'OK';
      ok.style.cssText = `padding:6px 14px;background:#ffd34a;color:#000;border:0;border-radius:4px;cursor:pointer;font-weight:bold;`;
      btnRow.append(cancel, ok);
      card.append(lbl, input, btnRow);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
      setTimeout(() => { input.focus(); input.select(); }, 0);

      const finish = (value: string): void => {
        overlay.remove();
        resolve(value);
      };
      ok.addEventListener('click', () => finish(input.value));
      cancel.addEventListener('click', () => finish(''));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') finish(input.value);
        else if (e.key === 'Escape') finish('');
      });
    });
  }

  private cleanupNet(): void {
    if (this.mode === 'host' || this.mode === 'join') {
      getNet().destroy();
    }
  }

  // ----- Character picker -----

  private buildPickTiles(cx: number, y: number): void {
    if (this.pickTiles) { this.pickTiles.destroy(); this.pickTiles = null; }
    const tileW = 60;
    const gap = 16;
    const totalW = HERO_NAMES.length * tileW + (HERO_NAMES.length - 1) * gap;
    const startX = cx - totalW / 2 + tileW / 2;
    const cont = this.add.container(0, 0);
    this.pickTiles = cont;

    const label = this.add.text(cx, y, 'PICK YOUR HERO', {
      fontFamily: 'Impact', fontSize: '14px', color: '#cfd6e4'
    }).setOrigin(0.5);
    cont.add(label);

    for (let i = 0; i < HERO_NAMES.length; i++) {
      const tx = startX + i * (tileW + gap);
      const rect = this.add.rectangle(tx, y + 38, tileW, tileW, HERO_COLORS[i])
        .setStrokeStyle(3, 0x000000).setInteractive({ useHandCursor: true });
      const txt = this.add.text(tx, y + 38, HERO_NAMES[i], {
        fontFamily: 'Impact', fontSize: '12px', color: '#000', stroke: '#fff', strokeThickness: 2
      }).setOrigin(0.5);
      const claimedBy = this.add.text(tx, y + 38 + tileW / 2 + 8, '', {
        fontFamily: 'monospace', fontSize: '10px', color: HERO_COLORS_HEX[i]
      }).setOrigin(0.5, 0);
      cont.add(rect); cont.add(txt); cont.add(claimedBy);
      rect.on('pointerdown', () => this.requestPick(i));
      // Tag the rect with its index for refresh
      (rect as Phaser.GameObjects.Rectangle & { _heroIdx?: number; _claimedTxt?: Phaser.GameObjects.Text })._heroIdx = i;
      (rect as Phaser.GameObjects.Rectangle & { _heroIdx?: number; _claimedTxt?: Phaser.GameObjects.Text })._claimedTxt = claimedBy;
    }
    this.refreshPickTiles();
  }

  private refreshPickTiles(): void {
    if (!this.pickTiles) return;
    const net = getNet();
    // Build inverse: colorIndex -> slot
    const colorToSlot: Record<number, number> = {};
    for (const [slotStr, ci] of Object.entries(this.picks)) {
      colorToSlot[ci as number] = Number(slotStr);
    }
    const peerName = (slot: number): string => net.peers.find((p) => p.playerSlot === slot)?.name ?? `P${slot}`;
    for (const child of this.pickTiles.list) {
      const r = child as Phaser.GameObjects.Rectangle & { _heroIdx?: number; _claimedTxt?: Phaser.GameObjects.Text };
      if (r._heroIdx === undefined) continue;
      const owner = colorToSlot[r._heroIdx];
      const isMine = owner === net.selfSlot;
      r.setStrokeStyle(isMine ? 4 : owner ? 3 : 2, isMine ? 0xffd34a : owner ? 0xffffff : 0x000000);
      r.setAlpha(owner && !isMine ? 0.55 : 1);
      if (r._claimedTxt) {
        r._claimedTxt.setText(owner ? peerName(owner) : '');
      }
    }
  }

  /** Click handler on a tile. Host applies directly; client requests via net. */
  private requestPick(colorIndex: number): void {
    const net = getNet();
    if (net.role === 'host' || net.role === 'solo') {
      this.applyPickRequest(net.selfSlot, colorIndex);
    } else {
      net.sendToHost({ t: 'pick', colorIndex });
    }
  }

  /** Host-side: claim if free, otherwise ignore. Re-broadcast picks map. */
  private applyPickRequest(slot: number, colorIndex: number): void {
    if (colorIndex < 0 || colorIndex >= HERO_NAMES.length) return;
    // Refuse if another slot already owns this color
    for (const [s, c] of Object.entries(this.picks)) {
      if (c === colorIndex && Number(s) !== slot) return;
    }
    // Drop slot's prior claim
    this.picks = { ...this.picks };
    delete this.picks[slot];
    this.picks[slot] = colorIndex;
    this.broadcastPicks();
    this.refreshPickTiles();
  }

  private broadcastPicks(): void {
    const net = getNet();
    if (net.role === 'host') {
      net.broadcast({ t: 'picks', picks: this.picks });
    }
  }

  private async copyJoinLink(code: string): Promise<void> {
    const url = `${window.location.origin}${window.location.pathname}?room=${code}`;
    try {
      await navigator.clipboard.writeText(url);
      this.statusText.setText('Link copied to clipboard!');
    } catch {
      // Fallback: show the URL in a prompt overlay
      this.statusText.setText(url);
    }
  }

  shutdown(): void {
    this.offNet?.();
    this.offStatus?.();
    this.offHostPick?.();
  }
}
