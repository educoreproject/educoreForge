# lib/xsd-forge — the general XSD kit

This kit forges a set of XML Schema (XSD) files into the DME roles.

- **Design:** `system/management/zNotesPlansDocs/nextStandards-102326/DESIGN-K3-xsdKit-102426.md` (wave 3 lane I, ruled by BRONZE_CROWN on 2026-10-24).
- **Relationship to the PESC kit:** this is a sibling of `lib/pesc-release-forge`, not a generalisation of it. Neither kit requires the other, so an edit to one can never move the other's blocks.

## What a bundle supplies

### 1. A profile JSON

`xsdProfileContract.js` validates it. Every field is required, and an unknown field is refused.

| Field | What it holds |
|---|---|
| `profileNote` | A free-text note about the profile. |
| `schemaSetList` | `[{ schemaSetName, entryFileList }]`. Each set is its entry files plus everything they import or include. The forged files are the union of these closures. |
| `schemaLocationTable` | Maps a `schemaLocation`, exactly as the source writes it, to a snapshot path. This is how an absolute URL is resolved. |
| `foreignNamespaceList` | `[{ namespace, reason }]`. These namespaces are not followed. References into them stay external and are carried as written. |
| `schemaFileExclusionList` | `[{ schemaFile, reason }]`. Every `.xsd` and `.wsdl` in the snapshot must be either forged or listed here. |
| `enumerationRepeatList` | `[{ schemaFile, enumerationLocator, reason }]`. Each entry is a publisher's repeated enumeration value. The repeat is carried once, on its option set. |
| `stableIdPrefix` | The prefix for every stable id. |
| `rootStableId` | The root's id. It must be the prefix followed by `root`. |
| `perStandardLabelByNodeKind` | One label for each node kind: `schemaFile`, `class`, `property`, `optionSet`, `optionValue`, `support`. |

A declaration that matches nothing in the source is stale, and a stale declaration is refused. This applies to exclusions, location rows, foreign namespaces and repeats.

### 2. A forge declaration

Its `stableIdPattern` must be `xsdIdentity.stableIdPatternFor(profile)`.

Its `additionalSourceInputList` must name `standardSourceLocation`. That file must appear in `SHA256SUMS`, and its `upstreamUrl:` line must be a bare URL.

The bundle's `parserDescriptor.ini` leaves out `sourceFile`, because the kit reads the snapshot directory rather than one file.

### 3. A hooks module

One line:

```js
require('lib/xsd-forge/xsdHooks')({ xsdProfile })
```

### 4. A round-trip pair

```js
require('lib/xsd-forge/xsdRoundTripPair')({ xsdProfile, stableUriPropertyName, ruleModulePath })
```

## What the kit owns

| Module | Job |
|---|---|
| `xsdTree.js` | The sax element tree. A byte copy of the PESC kit's version. |
| `xsdConstructRegistry.json` | What the kit has been taught, as data: the tag and position of each construct, the attributes each construct carries, its `mintKind`, its QName rules and the built-in types. |
| `xsdParser.js` | Resolves each tag by its namespace, never by its prefix. |
| `xsdSetLoader.js` | Follows the import and include closure, and accounts for every file in the snapshot. |
| `xsdResolution.js` | Resolves QNames through each file's own prefix bindings. |
| `xsdWalk.js` | Mints the nodes. |
| `xsdIdentity.js` | Builds the stable ids. These are keyed on the namespace. |
| `xsdHooks.js` | Supplies the bundle's hooks. |
| `xsdRoundTripPair.js` | Runs the round trip. |

Anything the registry does not list is refused by name. This covers a construct, a position or an attribute.

## The model, in brief

| XSD construct | DME node |
|---|---|
| A named or anonymous `complexType` | DmeClass |
| A local element or attribute, or an `element ref=` / `attribute ref=` | DmeProperty |
| A `simpleType` with enumerations | DmeOptionSet |
| Each enumeration | DmeOptionValue |
| Any other `simpleType`, and every global element, group, attribute group and schema file | DmeSupport |

Everything else rides verbatim on its owner's `xsdStructureList`. That covers compositors, derivations, facets, wildcards, imports, annotations, identity constraints and comments.

Each corpus QName gets exactly one edge. The edge carries `referenceConstruct`, `writtenQName` and `atLocator`. Built-in and foreign QNames get no edge.

A description is the node's own documentation, verbatim. Nothing is borrowed from elsewhere.

## Proof

`test/test-xsdForgeKit.js` runs on the fixture in `test/fixtures/xsdKitFixture/` and checks each construct, the round trip, every refusal and determinism.

The invert-and-watch-red mutations for this kit are kept in the lane's evidence directory (`k3RedTwins.py`).
