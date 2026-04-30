import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../core/constants';

interface InitData { score: number; }

export class GameOverScene extends Phaser.Scene {
  private score = 0;
  constructor() { super('GameOver'); }
  init(data: InitData): void { this.score = data.score; }
  create(): void {
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.85).setOrigin(0);
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 60, 'EMPLOYEES UNSAVED', {
      fontFamily: 'monospace', fontSize: '36px', color: '#ff5a4e'
    }).setOrigin(0.5);
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, `Recognition Score: ${this.score}`, {
      fontFamily: 'monospace', fontSize: '20px', color: '#ffffff'
    }).setOrigin(0.5);
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 60, 'Press SPACE to retry', {
      fontFamily: 'monospace', fontSize: '16px', color: '#bbbbbb'
    }).setOrigin(0.5);
    this.input.keyboard?.once('keydown-SPACE', () => this.scene.start('Game'));
  }
}
