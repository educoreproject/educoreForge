'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// toyHooks.js — the H2/H3 hook set for the Toy Standard fixture (SPEC-forgeFramework-v1.md §5):
// ONE loader (sourceLoaderList of length one — the single-parser "forge's method"), describeSource,
// emitContractGraph (the walk), describeRoot. Every node and edge is created through the kit; the
// walk holds no makeNode/addEdge of its own, calls no finalizer, no stamp, no embedTexts, no
// buildSearchText (gate G-SHARE greps for exactly that).
//
// The loader consumes ONLY bytes the framework has verified (forge() step 2 runs before step 3);
// the fixture is committed and pinned by SHA256SUMS, so a malformed model file cannot reach
// JSON.parse — a corrupted byte fails the checksum first — and no boundary try is needed here.
//
// PURE hooks: describeSource / emitContractGraph / describeRoot read only their arguments.

const fs = require('fs');
const path = require('path');
// the vocabulary registry, required by path exactly as every forge does today (a tree lib; not a
// sibling forge's lib and not the harness — G-NOGRAPH/G-SHARE permit it)
const { DME_ROLES, EDGE_TYPES } = require(path.join(__dirname, '..', '..', '..', '..', '..', 'vocabulary', 'vocabulary'));

const MODEL_FILE_NAME = 'toyModel.json';

const moduleFunction =
	({ moduleName } = {}) =>
	() => {
		// -----------------------------------------------------------------
		// H2 — the loader
		// -----------------------------------------------------------------
		const loadToyModel = ({ sourcePath, additionalSourceInputPathByName, xLog }, callback) => {
			const modelFilePath = fs.statSync(sourcePath).isDirectory() ? path.join(sourcePath, MODEL_FILE_NAME) : sourcePath;
			if (!fs.existsSync(modelFilePath)) {
				callback(`${moduleName}: model file '${modelFilePath}' is not on disk`);
				return;
			}
			const model = JSON.parse(fs.readFileSync(modelFilePath, 'utf8'));
			if (!Array.isArray(model.classes) || !Array.isArray(model.optionSets) || !Array.isArray(model.supports)) {
				callback(`${moduleName}: model file '${modelFilePath}' lacks classes/optionSets/supports arrays`);
				return;
			}
			xLog.status(`[forge-toy] loaded ${model.classes.length} classes, ${model.optionSets.length} option sets from ${path.basename(modelFilePath)}`);
			callback('', { model, modelFileName: path.basename(modelFilePath) });
		};

		// -----------------------------------------------------------------
		// describeSource — PURE; TWO version keys (FR2)
		// -----------------------------------------------------------------
		const describeSource = ({ parsed }) => ({
			version: parsed.toyModel.model.version,
			selfDescribedVersion: parsed.toyModel.model.version,
			sourceFormat: 'toy-json',
			sourceFiles: [parsed.toyModel.modelFileName],
			sourceUrl: parsed.toyModel.model.sourceUrl,
		});

		// -----------------------------------------------------------------
		// H3 — the walk. Identity rule: toy:<kind>/<naturalName>. Every creation through the kit.
		// -----------------------------------------------------------------
		const emitContractGraph = ({ parsed, metadata, kit }) => {
			const model = parsed.toyModel.model;
			const rootStableId = kit.rootStableId;
			const orderingByParent = {};

			// option sets FIRST so a property can point at its set (parented on the root; the
			// finalizer re-parents a single-owner set onto its owning property)
			const optionSetStableIdByName = {};
			model.optionSets.forEach((oneSet, setIndex) => {
				const setStableId = `toy:optionSet/${oneSet.name}`;
				optionSetStableIdByName[oneSet.name] = setStableId;
				kit.makeNode({
					role: DME_ROLES.OPTION_SET,
					perStandardLabel: 'ToyOptionSet',
					stableId: setStableId,
					name: oneSet.name,
					description: oneSet.description,
					structural: { parentId: rootStableId, path: oneSet.name },
					origin: `optionSets[${setIndex}]`,
				});
				kit.addEdge({ edgeType: EDGE_TYPES.HAS_OPTION_SET, fromStableId: rootStableId, toStableId: setStableId, edgeContext: `root->${oneSet.name}` });
				oneSet.values.forEach((oneValue, valueIndex) => {
					kit.emitOptionValue({
						optionSetStableId: setStableId,
						optionValueStableId: `toy:value/${oneSet.name}.${oneValue.code}`,
						perStandardLabel: 'ToyOptionValue',
						name: oneValue.label,
						path: `${oneSet.name}.${oneValue.code}`,
						owningName: oneSet.name,
						carriedProperties: kit.carriedProperties({ parsedObject: oneValue, carryList: ['code'] }),
						edgeContext: `${oneSet.name}->${oneValue.code}`,
						origin: `optionSets[${setIndex}].values[${valueIndex}]`,
					});
				});
			});

			model.classes.forEach((oneClass, classIndex) => {
				const classStableId = `toy:class/${oneClass.name}`;
				kit.makeNode({
					role: DME_ROLES.CLASS,
					perStandardLabel: 'ToyClass',
					stableId: classStableId,
					name: oneClass.name,
					description: oneClass.description,
					structural: { parentId: rootStableId, path: oneClass.name },
					origin: `classes[${classIndex}]`,
				});
				kit.addEdge({ edgeType: EDGE_TYPES.HAS_CLASS, fromStableId: rootStableId, toStableId: classStableId, edgeContext: `root->${oneClass.name}` });
				const propertyStableIdList = [];
				oneClass.properties.forEach((oneProperty, propertyIndex) => {
					const propertyStableId = `toy:property/${oneClass.name}.${oneProperty.name}`;
					propertyStableIdList.push(propertyStableId);
					kit.makeNode({
						role: DME_ROLES.PROPERTY,
						perStandardLabel: 'ToyProperty',
						stableId: propertyStableId,
						name: oneProperty.name,
						description: oneProperty.description,
						structural: { parentId: classStableId, path: `${oneClass.name}.${oneProperty.name}`, owningName: oneClass.name },
						carriedProperties: kit.carriedProperties({ parsedObject: oneProperty, carryList: ['dataType'] }),
						origin: `classes[${classIndex}].properties[${propertyIndex}]`,
					});
					kit.addEdge({ edgeType: EDGE_TYPES.HAS_PROPERTY, fromStableId: classStableId, toStableId: propertyStableId, edgeContext: `${oneClass.name}->${oneProperty.name}` });
					if (oneProperty.optionSet !== undefined) {
						kit.addEdge({
							edgeType: EDGE_TYPES.HAS_OPTION_SET,
							fromStableId: propertyStableId,
							toStableId: optionSetStableIdByName[oneProperty.optionSet],
							edgeContext: `${oneClass.name}.${oneProperty.name}->${oneProperty.optionSet}`,
						});
					}
				});
				// the class's properties are a sibling group in DOCUMENT order (the JSON states no schema order)
				orderingByParent[classStableId] = { orderSemantics: 'document', members: propertyStableIdList };
			});

			model.supports.forEach((oneSupport, supportIndex) => {
				const supportStableId = `toy:support/${oneSupport.name}`;
				kit.makeNode({
					role: DME_ROLES.SUPPORT,
					perStandardLabel: 'ToySupport',
					stableId: supportStableId,
					name: oneSupport.name,
					description: oneSupport.text,
					structural: { parentId: rootStableId, path: oneSupport.name },
					origin: `supports[${supportIndex}]`,
				});
				kit.addEdge({ edgeType: EDGE_TYPES.HAS_SUPPORT, fromStableId: rootStableId, toStableId: supportStableId, edgeContext: `root->${oneSupport.name}` });
			});

			return {
				nodes: kit.nodes,
				edges: kit.edges,
				stats: kit.stats,
				sequenceGroups: { orderingByParent },
				toyWalkReport: { classCount: model.classes.length, optionSetCount: model.optionSets.length },
			};
		};

		// -----------------------------------------------------------------
		// describeRoot — PURE; the description is SOURCE-STATED (never template-built)
		// -----------------------------------------------------------------
		const describeRoot = ({ parsed, metadata }) =>
			parsed.toyModel.model.description === undefined ? {} : { description: parsed.toyModel.model.description };

		return {
			sourceLoaderList: [{ loaderName: 'toyModel', load: loadToyModel }],
			describeSource,
			emitContractGraph,
			describeRoot,
		};
	};

module.exports = moduleFunction({ moduleName });
module.exports.MODEL_FILE_NAME = MODEL_FILE_NAME;
