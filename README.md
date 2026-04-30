# Awardco Crashers

A 4-player browser co-op beat-em-up themed around Awardco. Heroes are cartoon Awardco-logo characters saving employees from **Attrition**.

## Tech

- Phaser 3 + TypeScript + Vite
- Peer-to-peer multiplayer via WebRTC (PeerJS), host-authoritative
- Static site, deployed to GitHub Pages

## Develop

```bash
npm install
npm run dev
```

Open http://localhost:5173.

### Controls (keyboard, P1)

- Move: **WASD**
- Light attack: **J**
- Heavy attack: **K**
- Special: **L**
- Jump: **Space**
- Block: **Shift**

## Multiplayer (coming in Phase 3)

Host clicks **Host Game** → shares the room code. Others click **Join** and paste the code.

## Build

```bash
npm run build
```

Output is in `dist/`. The GitHub Pages workflow auto-deploys on push to `main`.
