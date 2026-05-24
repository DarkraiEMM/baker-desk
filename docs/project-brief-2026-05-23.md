# Baker Desk Project Brief

Last updated: 2026-05-23

## Product Goal

Baker Desk is a private local baking assistant for Windows. The original motivation is simple: make a visual, low-friction recipe tool that can be installed for one person, used offline, and kept private. It should help with recipe lookup, baker's percentage, scaling, technique notes, local recipe entry, and everyday baking questions without requiring a paid cloud API.

The app should feel like a useful desk tool, not a public service. Local data, source labels, export/import, and quiet installation matter more than social features.

## Current Deliverable

Latest installer:

```text
F:\BakerDesk\dist\BakerDesk-Setup-0.1.7-x64.exe
```

Installed test copy:

```text
G:\Baker Desk\baker-desk.exe
```

Current content size:

- 42 built-in calculable recipe Markdown files
- 20 knowledge/technique Markdown cards
- Recipe Markdown data is tiny, about tens of KB
- The large package size comes from the local GGUF model, not the recipe library

Current local model:

```text
src-tauri/resources/ai/models/qwen2.5-3b-instruct-q3_k_m.gguf
```

## Why The Package Is Large

The installer is about 1.6GB because it includes a local Qwen GGUF model and the llama.cpp runtime. Recipes and knowledge cards are very small. Adding hundreds of Markdown recipes will not materially change the package size compared with the model.

For future updates, avoid rebuilding or reinstalling the model unless the model itself changes.

## AI Boundary

The local AI is not the source of truth. It should be treated as:

- a recipe entry assistant
- a natural language rewriting layer
- a helper for turning rough notes into Baker Desk Markdown
- a helper for explaining the local rule engine's selected candidates

It should not be treated as:

- a reliable external recipe database
- an automatic web crawler
- a model that magically knows the missing LCB recipe archive
- the final authority for scaling or baker's percentage

The calculation core remains deterministic:

- recipe parsing
- ingredient search
- baker's percentage
- scaling
- local candidate selection
- tag/search matching

The AI can help organize a response after Baker Desk has selected local candidates.

## Source Repository Findings

Original reference repository:

```text
chefkannofriend-source/lcb-baker-agent
```

Audit summary:

- The public repository does not include the claimed full recipe archive.
- It includes rules, prompt logic, knowledge notes, scripts, and one example recipe.
- The README references recipe folders that are not present in the public repo.
- Therefore Baker Desk should not assume those 200-ish LCB recipes exist locally.
- What can be reused responsibly is the logic style: proportions, recipe reasoning, baker's percentage, ingredient relationships, and technique structure.

Local audit document:

```text
F:\BakerDesk\app\docs\source-repo-audit.md
```

## Current Features

Core app:

- React + TypeScript + Vite frontend
- Tauri desktop shell
- Windows installer via NSIS/MSI
- Local data loaded from `public/data`
- Sidebar navigation: chat, recipe library, technique library, entry/import
- Responsive pinboard that can be collapsed

Recipe library:

- Calculable recipes with ingredient tables
- Recipe detail view with totals, structure, kitchen signals, and scaling
- Baker's percentage based on detected or user-selected base ingredient
- Tags and featured/star state
- Source labels on recipe cards and detail pages
- Page-level recipe editing
- Built-in recipes save edits as local copies instead of mutating bundled data
- Local recipes save as local entries and are included in backups

Technique library:

- Technique/knowledge cards as separate knowledge pages
- Formula-like technique cards can be surfaced inside the recipe library
- Archive-style cards are allowed for weaker or reference-only content
- Recipe references without full ingredient tables are shown as references, not fake calculable recipes

Chat:

- Local rule-first behavior
- Handles recipe lookup, scaling, ingredient search, and technique lookup
- Preference-style recommendations use recipe statistics and tags
- Qwen/Ollama can rewrite grounded local conclusions when available
- If AI fails, local rules still answer

Data migration:

- Export/import user data JSON
- Local recipes, tags, and pinboard state can be moved to another computer
- Recipe packs can be imported without reinstalling the model

Recipe packs:

- Desktop app scans `recipe-packs` directories at startup
- JSON recipe packs are merged into the local recipe library
- Local user-edited recipes take priority over same-id pack recipes
- This enables adding recipes to an installed app without reinstalling AI

Example pack:

```text
F:\BakerDesk\recipe-packs\baker-desk-recipe-pack-2026-05-23-open-batch-02.json
G:\Baker Desk\recipe-packs\baker-desk-recipe-pack-2026-05-23-open-batch-02.json
```

## Data Source Policy

Every recipe and technique should show a source. Current source categories:

- original `lcb-baker-agent` example
- Baker Desk seed/base formulas
- Baker Desk local example recipes
- handwritten/user-provided recipes
- open-source Wikibooks/Wikilivres recipes with CC BY-SA attribution
- public domain historical recipes
- public baking guidance summarized into technique cards
- local user entry
- technique-note references with no complete ingredient table

For private personal use, it is acceptable to enter and adapt recipes the user has legitimately obtained. For shared/distributed built-in data, prefer open/public-domain/clearly attributed sources or user-authored formulas.

## Current Built-In Recipe Coverage

Foundational formulas include:

- brioche
- brownie
- creme patissiere
- creme mousseline
- pate a choux
- pate sucree
- ganache
- ganache montee
- biscuit joconde
- dacquoise
- Italian meringue
- praline
- croustillant praline
- cremeux caramel
- salted butter caramel

Open/common recipes include:

- white bread
- bagels
- pie crust
- pound cake
- Victoria sandwich
- carrot cake
- creme brulee
- shortbread
- scones
- chocolate chip cookies
- banana nut muffins
- rich brownies
- banana pancakes
- breakfast waffles
- crepes
- cinnamon buns
- focaccia
- deep dish pizza
- oatmeal chocolate chip cookies
- banana chocolate chip muffins

Handwritten/user recipes include:

- microwave pudding/custard note
- caramel syrup note

## Local Trial Notes

Brownie sugar control has a specific local note:

- A brownie formula inspired by a public chef video was tested with 10-20% sugar reduction.
- Result was good.
- The app should suggest small-step sugar reduction for brownies rather than pretending all low-sugar versions are equivalent.
- Reducing more than 20% should warn about crust shine, moistness, bitterness, and structure.

Relevant file:

```text
public/data/knowledge/brownie-sugar-control.md
```

## How To Update Recipes Without Reinstalling AI

Preferred path:

1. Create or generate a Baker Desk JSON data pack.
2. Place it in:

```text
G:\Baker Desk\recipe-packs
```

3. Restart Baker Desk.
4. The app reads the pack and merges recipes into the local library.

Manual path:

1. Open the app.
2. Go to `录入`.
3. Use `导入数据/配方包`.
4. Select the JSON pack.

Do not rebuild the 1.6GB installer just to add small recipe packs unless the built-in data or app behavior needs to change.

## How To Build

Frontend build and tests:

```powershell
cd F:\BakerDesk\app
npm.cmd run test:chat
npm.cmd run build
```

Tauri check/build on this machine may need Cargo in PATH:

```powershell
$env:Path = "C:\Users\76389\.cargo\bin;$env:Path"
npm.cmd run tauri -- build
```

Latest full installer output:

```text
F:\BakerDesk\app\src-tauri\target\release\bundle\nsis\Baker Desk_0.1.7_x64-setup.exe
F:\BakerDesk\dist\BakerDesk-Setup-0.1.7-x64.exe
```

## Important Files

Frontend:

```text
src/App.tsx
src/styles.css
src/chatEngine.ts
src/bakerCore.ts
src/desktopAi.ts
src/dataManifest.ts
src/trainingSet.ts
```

Desktop backend:

```text
src-tauri/src/lib.rs
src-tauri/tauri.conf.json
src-tauri/resources/ai/bin
src-tauri/resources/ai/models
```

Data:

```text
public/data/recipes
public/data/knowledge
```

Tests:

```text
tests/chatEngine.test.ts
```

Docs:

```text
README.md
DESKTOP.md
NOTICE.md
docs/source-repo-audit.md
docs/common-baking-question-bank.md
docs/project-brief-2026-05-23.md
```

## Known Limits

- Local Qwen is small. It can help phrase and organize, but it is not deeply expert by itself.
- The app does not currently browse the internet.
- Recipe entry from rough text works best when the source includes weights.
- If the source lacks weights, the AI should mark missing data instead of inventing values.
- Windows installer is unsigned, so Windows may show unknown publisher warnings.
- The package is large because the model is bundled.
- HarmonyOS/mobile deployment is not currently the priority; Windows local use is the cleanest path.

## Next Useful Work

High-value next steps:

1. Add a clearer "AI update recipe" workflow: preview proposed changes, then save as local copy.
2. Add a recipe-pack manager page: list installed packs, source, count, imported date.
3. Add local file-backed user data instead of relying mainly on browser localStorage.
4. Add more verified open recipes, especially common cakes, breads, cookies, tarts, fillings, and sauces.
5. Improve recommendation logic so it uses recipe scores visibly and consistently.
6. Add a compact "gift mode" first-run screen with no technical wording.
7. Add a plain user guide for the recipient: how to search, scale, pin, edit, export.

## Product Principle

Baker Desk should be honest. If a recipe is complete, it can calculate. If a note only mentions an example, it should be shown as a reference. If AI is only rewriting a local decision, the system should not pretend the model discovered new knowledge.

That honesty is what will make the tool feel trustworthy.
