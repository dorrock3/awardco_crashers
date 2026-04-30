import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../core/constants';
import { getNet, NetMessage } from '../net/NetTransport';

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
  private mode: 'menu' | 'host' | 'join' | 'soloPending' = 'menu';

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

    this.showMenu();

    this.statusText = this.add.text(cx, GAME_HEIGHT - 24, '', {
      fontFamily: 'monospace', fontSize: '12px', color: '#8aa0b8'
    }).setOrigin(0.5);

    const net = getNet();
    this.offStatus = net.onStatus((s) => { this.statusText.setText(s); });
    this.offNet = net.on((m) => this.handleNet(m));
  }

  private clearScreen(): void {
    // Destroy any non-permanent children below header
    for (const c of [...this.children.list]) {
      if (c instanceof Phaser.GameObjects.Text) {
        const t = c as Phaser.GameObjects.Text;
        if (t.y >= 150 && t !== this.statusText) t.destroy();
      } else if ((c as Phaser.GameObjects.Rectangle).type === 'Rectangle') {
        c.destroy();
      }
    }
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
    this.add.text(cx, 180, 'HOSTING…', {
      fontFamily: 'Impact', fontSize: '22px', color: '#ffd34a'
    }).setOrigin(0.5);
    this.codeText = this.add.text(cx, 240, '------', {
      fontFamily: 'monospace', fontSize: '54px', color: '#ffffff', stroke: '#000', strokeThickness: 4
    }).setOrigin(0.5);
    this.add.text(cx, 290, 'share this code with friends', {
      fontFamily: 'Arial', fontSize: '12px', color: '#8aa0b8'
    }).setOrigin(0.5);
    this.peerListText = this.add.text(cx, 330, 'Players:\n  1. ' + name + ' (you)', {
      fontFamily: 'monospace', fontSize: '14px', color: '#cfd6e4', align: 'center'
    }).setOrigin(0.5, 0);

    try {
      const code = await getNet().host(name);
      this.codeText.setText(code);
      this.makeButton(cx, GAME_HEIGHT - 90, 'START GAME', () => this.hostStart());
    } catch (e) {
      this.codeText.setText('FAILED');
      this.statusText.setText(`Host failed: ${(e as Error).message}`);
    }

    this.makeButton(cx, GAME_HEIGHT - 50, 'BACK', () => { this.cleanupNet(); this.showMenu(); })
      .setStyle({ backgroundColor: '#3a2a2a' });
  }

  private hostStart(): void {
    const net = getNet();
    net.broadcast({ t: 'start' });
    this.handleStart();
  }

  // ----- Join -----

  private async beginJoin(): Promise<void> {
    const name = await this.promptName('client');
    if (!name) { this.showMenu(); return; }
    const code = (await this.promptText('Enter room code:', '', 6)).trim().toUpperCase();
    if (!code) { this.showMenu(); return; }
    this.mode = 'join';
    this.clearScreen();
    const cx = GAME_WIDTH / 2;

    this.add.text(cx, 200, 'JOINING ' + code + '…', {
      fontFamily: 'Impact', fontSize: '22px', color: '#ffd34a'
    }).setOrigin(0.5);
    this.peerListText = this.add.text(cx, 260, 'Connecting…', {
      fontFamily: 'monospace', fontSize: '14px', color: '#cfd6e4', align: 'center'
    }).setOrigin(0.5, 0);

    try {
      await getNet().join(code, name);
      this.peerListText.setText('Connected. Waiting for host to start…');
    } catch (e) {
      this.peerListText.setText(`Failed: ${(e as Error).message}`);
    }

    this.makeButton(cx, GAME_HEIGHT - 50, 'BACK', () => { this.cleanupNet(); this.showMenu(); })
      .setStyle({ backgroundColor: '#3a2a2a' });
  }

  // ----- Net events -----

  private handleNet(msg: NetMessage): void {
    if (msg.t === 'lobby' || msg.t === 'welcome') {
      this.refreshPeerList();
    } else if (msg.t === 'start') {
      this.handleStart();
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

  shutdown(): void {
    this.offNet?.();
    this.offStatus?.();
  }
}
