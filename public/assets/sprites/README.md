# Sprite assets

Each character has its own folder. See [../../docs/art-pipeline.md](../../docs/art-pipeline.md) for the full spec.

```
hero-red/        torso.png head.png arm_l.png ... rig.json
hero-blue/
hero-green/
hero-yellow/
sad-employee/
boss-minion/
attrition/
```

The runtime falls back to colored placeholder rectangles when a folder is missing or incomplete. Drop assets in and the next page reload will pick them up.
