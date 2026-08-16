'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// toyRoundTripPair.js — H4 for the Toy Standard fixture (Profile §8.5): a SOURCE-side canonicalizer and
// a GRAPH-side emitter held apart on purpose, so the instrument cannot merely prove the forge agrees
// with itself. Both produce Map<statementKey, statement> over ONE headline vocabulary:
//   class|<Name>                          value { name }
//   class|<Name>|description              value { text }
//   property|<Class>.<Name>|dataType      value { dataType }
//   property|<Class>.<Name>|description   value { text }
//   optionSet|<Name>                      value { name }
//   value|<Set>.<Code>|label              value { label }
//   support|<Name>                        value { name }
// The canonicalizer reads ONLY the snapshot bytes (never the graph); the emitter reads ONLY the
// reader (never a source file). Both are callback-shaped (RT-8); the emitter's fault is fatal.
//
// semanticValidationLimit (Profile §8.4): what this round trip models and does not.

const fs = require('fs');
const path = require('path');

const MODEL_FILE_NAME = 'toyModel.json';

const SEMANTIC_VALIDATION_LIMIT =
	'SEMANTIC round-trip over the statement domain THIS INSTRUMENT MODELS: class, property, option set, ' +
	'option value and support DECLARATIONS at NAME precision, class/property descriptions and value ' +
	'labels verbatim, property dataType verbatim. NOT modelled: the support note text (deliberately ' +
	'omitted — the emitter does not read it, so it is reported as an explicitlyOmitted loss on the ' +
	'source side, not as fidelity), option-set descriptions, ordering of any kind, whitespace, and the ' +
	'model-level version/sourceUrl (carried by the root, checked by the framework, not by this pair).';

const moduleFunction =
	({ moduleName } = {}) =>
	() => {
		const canonicalizeSource = ({ snapshotPath, verifiedFileList }, callback) => {
			const modelFilePath = fs.statSync(snapshotPath).isDirectory() ? path.join(snapshotPath, MODEL_FILE_NAME) : snapshotPath;
			if (!fs.existsSync(modelFilePath)) {
				callback(`${moduleName}: model file '${modelFilePath}' is not on disk`);
				return;
			}
			const model = JSON.parse(fs.readFileSync(modelFilePath, 'utf8'));
			const statements = new Map();
			model.classes.forEach((oneClass) => {
				statements.set(`class|${oneClass.name}`, { name: oneClass.name });
				if (oneClass.description !== undefined) {
					statements.set(`class|${oneClass.name}|description`, { text: oneClass.description });
				}
				oneClass.properties.forEach((oneProperty) => {
					statements.set(`property|${oneClass.name}.${oneProperty.name}|dataType`, { dataType: oneProperty.dataType });
					if (oneProperty.description !== undefined) {
						statements.set(`property|${oneClass.name}.${oneProperty.name}|description`, { text: oneProperty.description });
					}
				});
			});
			model.optionSets.forEach((oneSet) => {
				statements.set(`optionSet|${oneSet.name}`, { name: oneSet.name });
				oneSet.values.forEach((oneValue) => {
					statements.set(`value|${oneSet.name}.${oneValue.code}|label`, { label: oneValue.label });
				});
			});
			model.supports.forEach((oneSupport) => {
				statements.set(`support|${oneSupport.name}`, { name: oneSupport.name });
				// the note TEXT is a dimension the emitter does not model — declared explicitlyOmitted
				statements.set(`support|${oneSupport.name}|text`, { text: oneSupport.text, explicitlyOmitted: true });
			});
			callback('', { statements, stats: { classCount: model.classes.length, statementCount: statements.size } });
		};

		const emitFromGraph = ({ reader }, callback) => {
			reader.readAll((readError, graph) => {
				if (readError) {
					callback(readError);
					return;
				}
				const statements = new Map();
				const nodeByStableId = {};
				graph.nodes.forEach((oneNode) => {
					nodeByStableId[oneNode.stableId] = oneNode;
				});
				let fault;
				graph.nodes.forEach((oneNode) => {
					const props = oneNode.properties;
					if (oneNode.role === 'DmeClass') {
						statements.set(`class|${props.name}`, { name: props.name });
						if (props.description !== undefined) {
							statements.set(`class|${props.name}|description`, { text: props.description });
						}
					} else if (oneNode.role === 'DmeProperty') {
						const owningClass = nodeByStableId[props.parentId];
						if (!owningClass) {
							fault = `property '${oneNode.stableId}' has no resolvable parent class`;
							return;
						}
						statements.set(`property|${owningClass.properties.name}.${props.name}|dataType`, { dataType: props.dataType });
						if (props.description !== undefined) {
							statements.set(`property|${owningClass.properties.name}.${props.name}|description`, { text: props.description });
						}
					} else if (oneNode.role === 'DmeOptionSet') {
						statements.set(`optionSet|${props.name}`, { name: props.name });
					} else if (oneNode.role === 'DmeOptionValue') {
						const owningSet = nodeByStableId[props.parentId];
						if (!owningSet) {
							fault = `value '${oneNode.stableId}' has no resolvable parent set`;
							return;
						}
						statements.set(`value|${owningSet.properties.name}.${props.code}|label`, { label: props.name });
					} else if (oneNode.role === 'DmeSupport') {
						statements.set(`support|${props.name}`, { name: props.name });
					}
				});
				if (fault !== undefined) {
					callback('', { fault });
					return;
				}
				callback('', { statements, stats: { nodeCount: graph.nodes.length, edgeCount: graph.edges.length, statementCount: statements.size } });
			});
		};

		return { canonicalizeSource, emitFromGraph, semanticValidationLimit: SEMANTIC_VALIDATION_LIMIT };
	};

module.exports = moduleFunction({ moduleName });
