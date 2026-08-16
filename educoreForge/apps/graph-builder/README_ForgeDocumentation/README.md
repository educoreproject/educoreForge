# Forge Documentation — index

Everything about writing, migrating and proving a **forge** (the code that turns one education
data standard into a graph for the Data Model Explorer) lives in this directory. Read in the order
that matches your purpose.

| file | what it is | read it when |
|---|---|---|
| `README_ForgeCreationOverview.md` | The overview: the kitchen metaphor, the terms, what a forge supplies, what the framework does, how a forge is proven. | First, always. |
| `README_HOWTO_ForgeCreationInstructions.md` | The step-by-step procedure for writing a new forge: descriptor, entry module, hooks, walk, validator, tests, certification. | You are about to write or migrate a forge. |
| `README_ForgeProfile.md` | The **normative** profile: what every forge MUST satisfy — descriptor, seam, identity, determinism, round trip, refusal doctrine, provenance, gates, punch list. Version in its header. | You need the rule, not the recipe. |
| `README_ForgeFrameworkSpecification.md` | The **normative** framework specification: the factory and object, the kit, the declaration object, the hooks, the execute pipeline, the compatibility-declaration registry, the migration recipe, the acceptance test, the gate suite with red twins. Version in its header. | You are changing the framework, adding an allowance, or migrating a forge. |
| `README_MILO_ForgeWorkOrientation.md` | Orientation for a Milo (or any engineer) picking this work up cold: where the truth lives, the acceptance discipline, the frozen commands, what never to touch. | You are the next one to work on forges. |

## The one-paragraph version

A forge brings three things — a **declaration** (data about the standard), **hooks** (its loaders,
its `describeSource`, its walk `emitContractGraph`, its `describeRoot`), and a **round-trip
validator**. The framework in `lib/forge-framework/` owns everything else: source verification,
version stamping, the root node, finalizers, embedding, the return shape, and the refusals. The
kit is the only door for creating nodes and edges. Every known departure from the Profile is a
declared, named compatibility row; the framework refuses undeclared ones and unused ones. A forge is
accepted when it reproduces its block id byte for byte under a frozen command.

## Where the code is

- Framework: `lib/forge-framework/` (13 flat modules) and `lib/forge-framework/roundTripHarness/`.
- Framework gates: `lib/forge-framework/test/` (every gate has a twin that turns it red); frozen
  acceptance commands and ids in `lib/forge-framework/test/acceptance/`.
- Worked example of a forge on the framework: `forges/edfi/` (`forgeEdfi.js`,
  `lib/edfiForgeDeclaration.js`, `lib/edfiHooks.js`, `lib/forgeEdfiContractGraph.js`).
- Forges not yet on the framework: `forges/sif/`, `forges/pesc260805/`, `forges/ceds/`.
- The seam the framework satisfies unchanged: `apps/forger/forger.js` (factory call and `forge()`
  call site), `interfaces.js` (`ForgeBundle`).
- graphBuilder-wide control-flow doctrine (not forge-specific): `../DOCTRINE.md`.

## What is NOT here

Process records — plans, briefs, supervisor rulings, adversarial reviews, stand-down holdings, the
DEVLOG — live under `system/management/zNotesPlansDocs/forgeDefinitionV2/`. The **Bridge Profile**
and bridge requirements (how standards are mapped to each other) are a separate package in that
same folder; a forge does no bridging.
