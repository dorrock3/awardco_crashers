import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../core/constants';

interface InitData { score: number; defeated: number; }

export class WinScene extends Phaser.Scene {
  private score = 0;
  private defeated = 0;
  constructor() { super('Win'); }
  init(data: InitData): void { this.score = data.score; this.defeated = data.defeated; }
  create(): void {
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x0a1a0a, 0.9).setOrigin(0);
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 80, 'ATTRITION DEFEATED!', {
      fontFamily: 'monospace', fontSize: '36px', color: '#5ed16a'
    }).setOrigin(0.5);
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 20, `The employees are recognized.`, {
      fontFamily: 'monospace', fontSize: '18px', color: '#ffffff'
    }).setOrigin(0.5);
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 20,
      `Recognition Score: ${this.score}\nEmployees Saved: ${this.defeated}`, {
      fontFamily: 'monospace', fontSize: '16px', color: '#ffffff', align: 'center'
    }).setOrigin(0.5);
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 90, 'Press SPACE to play again', {
      fontFamily: 'monospace', fontSize: '14px', color: '#bbbbbb'
    }).setOrigin(0.5);
    this.input.keyboard?.once('keydown-SPACE', () => this.scene.start('Game'));
  }
}
