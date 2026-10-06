'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// required-property-finisher.js — registry member, mode 'apply', placed before graphMeta (campaign P2, W-A-10 / V1-C26).
//
// REQUIRED_PROPERTIES.NODE_BY_ROLE_CLASS declares what a content node of each role class must carry. The forge enforces
// the embeddable / nonEmbeddable half at forge time; this finisher checks EVERY class over the FINISHED graph — the one
// place all forges' nodes, the hub cards and the text nodes meet — and refuses the verb on any violation, naming the
// class, the count, the missing names and up to ten stableIds. Nothing is written.
//
// THE CLASS OF A NODE, as the graph can see it (roots carry no nonEmbeddableRoleList, code fact, so the forge's own split
// is not readable here): a DmeEmbedText is embedText; a HubReference is hubReference; a HubDefinition is hubDefinition;
// any other content node carrying searchText OR embedding is embeddable (so the gate proves the two travel together), and
// one carrying neither is nonEmbeddable. The predicate table is DATA, and its class names must equal the vocabulary's —
// a class declared without a predicate, or a predicate for an undeclared class, refuses construction.
//
//   factory({ vocabulary }) → { apply, ROLE_CLASS_PREDICATE_BY_CLASS, censusCypherFor }
//
// Async style: qtools taskListPlus/pipeRunner; callback(errString, result). No async/await, no try/catch-for-control-flow.

const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ vocabulary } = {}) => {
		const { REQUIRED_PROPERTIES, NODE_LABELS, EMBED_TEXT_VECTOR } = vocabulary;
		const NODE_BY_ROLE_CLASS = REQUIRED_PROPERTIES.NODE_BY_ROLE_CLASS;
		const SPECIAL_LABEL_LIST = [EMBED_TEXT_VECTOR.label, 'HubReference', 'HubDefinition'];
		const notSpecialText = SPECIAL_LABEL_LIST.map((oneLabel) => `NOT n:\`${oneLabel}\``).join(' AND ');
		const ROLE_CLASS_PREDICATE_BY_CLASS = Object.freeze({
			embedText: `n:\`${EMBED_TEXT_VECTOR.label}\``,
			hubReference: 'n:`HubReference`',
			hubDefinition: 'n:`HubDefinition`',
			embeddable: `${notSpecialText} AND (n.searchText IS NOT NULL OR n.embedding IS NOT NULL)`,
			nonEmbeddable: `${notSpecialText} AND n.searchText IS NULL AND n.embedding IS NULL`,
		});
		const declaredClassText = Object.keys(NODE_BY_ROLE_CLASS).sort().join(', ');
		const predicateClassText = Object.keys(ROLE_CLASS_PREDICATE_BY_CLASS).sort().join(', ');
		if (declaredClassText !== predicateClassText) {
			throw new Error(`${moduleName} REFUSED: the role classes REQUIRED_PROPERTIES.NODE_BY_ROLE_CLASS declares (${declaredClassText}) are not the classes this finisher can recognise (${predicateClassText})`);
		}

		const censusCypherFor = (oneClassName) => `
			MATCH (n:\`${NODE_LABELS.FORGED_NODE}\`) WHERE n._source IS NOT NULL AND ${ROLE_CLASS_PREDICATE_BY_CLASS[oneClassName]}
			  AND (${NODE_BY_ROLE_CLASS[oneClassName].map((onePropertyName) => `n.\`${onePropertyName}\` IS NULL`).join(' OR ')})
			WITH count(n) AS violationCount, collect(n)[0..1000] AS violatorSampleList
			RETURN violationCount, [oneNode IN violatorSampleList[0..10] | oneNode.stableId] AS sampleList,
			       [onePropertyName IN ${JSON.stringify(NODE_BY_ROLE_CLASS[oneClassName])} WHERE any(oneNode IN violatorSampleList WHERE oneNode[onePropertyName] IS NULL)] AS missingNameList`;
		const numberFrom = (oneRecord, fieldName) => {
			const raw = oneRecord.get(fieldName);
			return raw && typeof raw.toNumber === 'function' ? raw.toNumber() : Number(raw);
		};

		const apply = ({ runCypher } = {}, callback) => {
			if (typeof runCypher !== 'function') {
				callback(`${moduleName}: a runCypher is REQUIRED`);
				return;
			}
			const taskList = new taskListPlus();
			const violationList = [];
			Object.keys(NODE_BY_ROLE_CLASS).forEach((oneClassName) => {
				taskList.push((args, next) => {
					runCypher({ cypher: censusCypherFor(oneClassName) }, (err, result) => {
						const rows = (result && result.records) || [];
						if (err || rows.length !== 1) {
							next(`${moduleName}: the ${oneClassName} census failed${err ? `: ${err}` : ` (${rows.length} rows)`}`);
							return;
						}
						const violationCount = numberFrom(rows[0], 'violationCount');
						if (violationCount > 0) {
							violationList.push(`${oneClassName}: ${violationCount} node(s) lack ${(rows[0].get('missingNameList') || []).join('/') || 'a required property'} (e.g. ${(rows[0].get('sampleList') || []).join(', ')})`);
						}
						next('', args);
					});
				});
			});
			pipeRunner(taskList.getList(), {}, (err) => {
				if (err) {
					callback(err);
					return;
				}
				if (violationList.length) {
					callback(`${moduleName} REFUSED: content nodes lack the properties REQUIRED_PROPERTIES.NODE_BY_ROLE_CLASS declares for their class — ${violationList.join(' | ')}`);
					return;
				}
				callback('', { summary: `required properties: every content node carries its class's set (${Object.keys(NODE_BY_ROLE_CLASS).join(', ')})`, classCount: Object.keys(NODE_BY_ROLE_CLASS).length });
			});
		};

		return { apply, ROLE_CLASS_PREDICATE_BY_CLASS, censusCypherFor };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
