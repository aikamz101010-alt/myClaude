# Avatar VRM model

Drop your character here as **`character.vrm`** (this exact path):

```
public/avatar/character.vrm
```

The talking avatar (toggle the 🤖 button in a project's titlebar) will load it,
lip-sync to Claude's spoken replies, and idle-animate (blink + head sway).

## Where to get a VRM

- **VRoid Studio** (free, recommended) — design your own anime character and
  export as `.vrm`: https://vroid.com/en/studio
- **Booth.pm** — many free / paid VRM avatars
- **three-vrm samples** — grab a sample `.vrm` to test quickly:
  https://github.com/pixiv/three-vrm/tree/dev/packages/three-vrm/examples/models

VRM 0.x and VRM 1.0 are both supported (via `@pixiv/three-vrm`).

To use a different file/location, change the model URL in the avatar store
(`src/store/avatarStore.ts` → `DEFAULT_VRM_URL`).
