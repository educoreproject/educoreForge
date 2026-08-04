'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// roundTripEdfiCompiler.js — forge-edfi Phase 3: the GRAPH side of the round trip. Reads the
// MATERIALIZED EdFi graph over bolt (RT-4 — never the forge's own output; TQ's founding ruling,
// preserved in the CEDS compiler header: compiling from the forge's result "would prove only
// that the forge remembers what it just read; compiling from the GRAPH proves what the GRAPH
// ITSELF can support") and re-emits canonical statements in the SAME statement grammar the
// independent reducer produces (roundTripMetaEdCanonical.js).
//
// LAYER RULING (RT-4): every query is scoped `_source: 'EdFi'` and names its roles explicitly.
// WHAT IS READ: nodes of roles DmeStandardRoot (identity only), DmeClass, DmeOptionSet,
// DmeSupport, DmeProperty, DmeOptionValue — an EXPLICIT property projection per role family —
// plus ONE edge family: REFERENCES edges leaving domain/subdomain/interchange/
// interchangeExtension constructs (domain items and interchange components exist ONLY as
// edges). WHAT IS DELIBERATELY NOT READ (a visible decision, not an accident — pesc precedent):
//   - HAS_CLASS / HAS_SUPPORT root-ownership edges and the orphan-anchoring HAS_OPTION_SET
//     edges from the root (reachability apparatus, not source content)
//   - HAS_PROPERTY (the property's owner is carried as owningConstructName/owningConstructType
//     scalars — the carrier of record)
//   - property-level REFERENCES / REFERENCES_TYPE / HAS_OPTION_SET (redundant carriers; the
//     property's name/sharedTypeName scalars are the carrier of record)
//   - HAS_VALUE (the option value's parentId scalar is the carrier of record)
//   - SUBCLASS_OF (the baseName/baseNamespace scalars are the carrier of record)
//   - searchText, embedding, path/depth, crossRef stash CONTENT as statements (the stash feeds
//     the R-WO-12 invention guard, never the statement domain), Layer 2 hub apparatus
//
// GRAMMAR-YES-DATA-NO (RT-5): this module knows the forge's stableId scheme, the statement
// subject scheme, and the mechanical inversions (roleName-prefix strip for the source-local
// property name; namespace reassembly from carried *Namespace scalars). It contains NO value
// that varies by subject. The source bytes never enter here — they enter once, at the diff, as
// the answer key.
//
// Bolt endpoint and credentials are resolved from the RUNNING CONTAINER (docker inspect) —
// never hardcoded, never guessed (§5.1). No endpoint -> refusal by name.
//
// Async style: qtools taskListPlus/pipeRunner; error-first callbacks (RT-8/R7); no async/await;
// no try/catch as control flow (the one JSON.parse adapter is throw-to-error at a declared
// seam). camelCase only.

const { execFile } = require('child_process');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const roundTripMetaEdCanonical = require('./roundTripMetaEdCanonical')();
const { collapseWhitespace } = roundTripMetaEdCanonical;

const STANDARD_SOURCE = 'EdFi';
const DEFAULT_PAGE_SIZE = 2000;

// ============================================================
// role and projection registries (house law: registry over switch)
// ============================================================

const CONSTRUCT_ROLES = ['DmeClass', 'DmeOptionSet', 'DmeSupport'];

// the explicit projection per row family — every property the emitter reads is NAMED here
const CONSTRUCT_READ_PROPERTY_LIST = [
	'stableId', 'role', 'name', 'constructType', 'description', 'metaEdId', 'deprecatedText',
	'footerDocumentationText', 'extendedDocumentationText', 'useCaseDocumentationText',
	'mapTypeDocumentationText', 'allowPrimaryKeyUpdates', 'mapTypeRequired', 'isBigInteger',
	'subdomainPosition', 'parentDomainName', 'baseName', 'baseNamespace', 'extendeeName',
	'extendeeNamespace', 'minValue', 'maxValue', 'minValueDecimal', 'maxValueDecimal',
	'minLength', 'maxLength', 'totalDigits', 'decimalPlaces', 'cedsId', 'crossRefs',
	'sourceFileRelativePath', 'sourceLineNumber',
];

const PROPERTY_READ_PROPERTY_LIST = [
	'stableId', 'name', 'owningConstructName', 'owningConstructType', 'propertyType',
	'description', 'documentationInherited', 'annotationKind', 'renamesIdentityPropertyName',
	'roleNameName', 'shortenToName', 'isQueryableField', 'potentiallyLogical', 'isWeakReference',
	'commonExtensionOverride', 'propertyNamespace', 'sharedTypeName', 'sharedTypeNamespace',
	'sharedPropertyName', 'metaEdId', 'deprecatedText', 'minValue', 'maxValue',
	'minValueDecimal', 'maxValueDecimal', 'minLength', 'maxLength', 'totalDigits',
	'decimalPlaces', 'mergeDirectives', 'cedsId', 'crossRefs', 'sourceFileRelativePath',
	'sourceLineNumber',
];

const OPTION_VALUE_READ_PROPERTY_LIST = [
	'stableId', 'name', 'parentId', 'valueOrigin', 'description', 'shortDescription',
	'namespace', 'metaEdId', 'cedsOptionCode', 'crossRefs', 'sourceFileRelativePath',
];

const ROOT_READ_PROPERTY_LIST = [
	'stableId', 'name', 'standardKey', 'standardName', 'version', 'snapshotKey',
	'publishedVersion', 'versionSource', 'parserVersion',
];

// construct scalar -> statement predicate + transform kind
//   'collapse' = whitespace-collapsed prose; 'verbatim' = String() carried exactly;
//   'boolText' = boolean -> 'true'/'false'
const CONSTRUCT_SCALAR_EMISSION_REGISTRY = [
	['description', 'documentation', 'collapse'],
	['metaEdId', 'metaEdId', 'verbatim'],
	['deprecatedText', 'deprecated', 'collapse'],
	['footerDocumentationText', 'footerDocumentation', 'collapse'],
	['extendedDocumentationText', 'extendedDocumentation', 'collapse'],
	['useCaseDocumentationText', 'useCaseDocumentation', 'collapse'],
	['mapTypeDocumentationText', 'mapTypeDocumentation', 'collapse'],
	['allowPrimaryKeyUpdates', 'allowPrimaryKeyUpdates', 'boolText'],
	['mapTypeRequired', 'mapTypeRequired', 'boolText'],
	['isBigInteger', 'isBigInteger', 'boolText'],
	['subdomainPosition', 'subdomainPosition', 'verbatim'],
	['minValue', 'minValue', 'verbatim'],
	['maxValue', 'maxValue', 'verbatim'],
	['minValueDecimal', 'minValueDecimal', 'verbatim'],
	['maxValueDecimal', 'maxValueDecimal', 'verbatim'],
	['minLength', 'minLength', 'verbatim'],
	['maxLength', 'maxLength', 'verbatim'],
	['totalDigits', 'totalDigits', 'verbatim'],
	['decimalPlaces', 'decimalPlaces', 'verbatim'],
];

const PROPERTY_SCALAR_EMISSION_REGISTRY = [
	['description', 'documentation', 'collapse'],
	['documentationInherited', 'documentationInherited', 'boolText'],
	['propertyType', 'propertyType', 'verbatim'],
	['annotationKind', 'annotation', 'verbatim'],
	['renamesIdentityPropertyName', 'renamesIdentityProperty', 'verbatim'],
	['roleNameName', 'roleName', 'verbatim'],
	['shortenToName', 'shortenTo', 'verbatim'],
	['isQueryableField', 'queryableField', 'boolText'],
	['potentiallyLogical', 'potentiallyLogical', 'boolText'],
	['isWeakReference', 'isWeakReference', 'boolText'],
	['commonExtensionOverride', 'commonExtensionOverride', 'boolText'],
	['metaEdId', 'metaEdId', 'verbatim'],
	['deprecatedText', 'deprecated', 'collapse'],
	['minValue', 'minValue', 'verbatim'],
	['maxValue', 'maxValue', 'verbatim'],
	['minValueDecimal', 'minValueDecimal', 'verbatim'],
	['maxValueDecimal', 'maxValueDecimal', 'verbatim'],
	['minLength', 'minLength', 'verbatim'],
	['maxLength', 'maxLength', 'verbatim'],
	['totalDigits', 'totalDigits', 'verbatim'],
	['decimalPlaces', 'decimalPlaces', 'verbatim'],
];

const SUBCLASS_CONSTRUCT_TYPES = ['associationSubclass', 'commonSubclass', 'domainEntitySubclass'];
const EXTENSION_CONSTRUCT_TYPES = [
	'associationExtension', 'commonExtension', 'domainEntityExtension', 'interchangeExtension',
];
const SHARED_PROPERTY_TYPES = ['sharedString', 'sharedInteger', 'sharedShort', 'sharedDecimal'];
const ITEM_CARRIER_CONSTRUCT_TYPES = ['domain', 'subdomain', 'interchange', 'interchangeExtension'];

const applyTransform = (transformKind, rawValue) => {
	if (transformKind === 'collapse') {
		return collapseWhitespace(rawValue);
	}
	if (transformKind === 'boolText') {
		if (rawValue === true || rawValue === 'true') {
			return 'true';
		}
		if (rawValue === false || rawValue === 'false') {
			return 'false';
		}
		// a boolean-registry field holding a non-boolean is malformed graph data — surfaced as a
		// fault by the caller, never quietly coerced (polyArch2 §6)
		return undefined;
	}
	return `${rawValue}`;
};

const qualifiedNameFor = ({ localName, namespacePrefix }) =>
	namespacePrefix ? `${namespacePrefix}.${localName}` : `${localName}`;

// invert the forge's effective-name rule: effectiveName = roleNameName + baseName when
// roleNameName differs from baseName; baseName otherwise (a mechanical inversion of
// effectivePropertyNameFor — hermetically tested)
const invertEffectivePropertyName = ({ effectiveName, roleNameName }) => {
	if (!roleNameName) {
		return effectiveName;
	}
	if (effectiveName === roleNameName) {
		return effectiveName; // roleNameName === baseName: no prefix was applied
	}
	if (effectiveName.startsWith(roleNameName) && effectiveName.length > roleNameName.length) {
		return effectiveName.slice(roleNameName.length);
	}
	return undefined; // uninvertible — a canonicalization fault, surfaced by the caller
};

// invert the forge's construct stableId: edfi:<constructType>/<name>
const parseConstructStableId = (stableIdText) => {
	const schemeMatch = `${stableIdText}`.match(/^edfi:([A-Za-z]+)\/(.+)$/);
	if (!schemeMatch) {
		return undefined;
	}
	return { constructType: schemeMatch[1], constructName: schemeMatch[2] };
};

// ============================================================
// moduleFunction
// ============================================================

const moduleFunction = () => {
	// --------------------------------------------------------
	// resolveContainerBolt — bolt endpoint + credential from the RUNNING container, docker
	// inspect (§5.1; ceds/pesc-proven pattern). Everything missing is a named refusal — no
	// default port, no default credential.
	//   inputs: { containerName, runDockerCommand? }   (runDockerCommand injectable for tests)
	//   callback(errString, { containerName, boltUrl, user, password })
	// --------------------------------------------------------
	const resolveContainerBolt = ({ containerName, runDockerCommand }, callback) => {
		if (!containerName) {
			callback(`${moduleName}.resolveContainerBolt: containerName is REQUIRED and has no default.`);
			return;
		}
		const dockerCommandRunner =
			runDockerCommand ||
			((argList, runnerCallback) =>
				execFile('docker', argList, { maxBuffer: 8 * 1024 * 1024 }, runnerCallback));

		dockerCommandRunner(['inspect', containerName], (dockerError, stdout) => {
			if (dockerError) {
				callback(
					`${moduleName}.resolveContainerBolt: docker inspect '${containerName}' failed — ${dockerError.message || dockerError}. The container must be running; nothing is guessed.`,
				);
				return;
			}
			let inspectRecord;
			let parseFault = '';
			try {
				inspectRecord = JSON.parse(stdout)[0];
			} catch (thrownError) {
				parseFault = thrownError.message;
			}
			if (parseFault || !inspectRecord) {
				callback(
					`${moduleName}.resolveContainerBolt: docker inspect '${containerName}' returned unparseable output${parseFault ? ` (${parseFault})` : ''}.`,
				);
				return;
			}
			const portBindingList =
				(inspectRecord.NetworkSettings &&
					inspectRecord.NetworkSettings.Ports &&
					inspectRecord.NetworkSettings.Ports['7687/tcp']) ||
				[];
			const boltBinding = portBindingList.find((oneBinding) => oneBinding && oneBinding.HostPort);
			if (!boltBinding) {
				callback(
					`${moduleName}.resolveContainerBolt: container '${containerName}' publishes no host port for 7687/tcp. There is no bolt endpoint to read and one is not guessed at.`,
				);
				return;
			}
			const environmentList = (inspectRecord.Config && inspectRecord.Config.Env) || [];
			const authEntry = environmentList.find((oneEntry) => oneEntry.startsWith('NEO4J_AUTH='));
			if (!authEntry) {
				callback(
					`${moduleName}.resolveContainerBolt: container '${containerName}' declares no NEO4J_AUTH in its environment. The credential is read from the container, never assumed.`,
				);
				return;
			}
			const authValue = authEntry.slice('NEO4J_AUTH='.length);
			const slashIndex = authValue.indexOf('/');
			if (slashIndex < 1) {
				callback(
					`${moduleName}.resolveContainerBolt: container '${containerName}' NEO4J_AUTH is not user/password shaped.`,
				);
				return;
			}
			callback('', {
				containerName,
				boltUrl: `bolt://localhost:${boltBinding.HostPort}`,
				user: authValue.slice(0, slashIndex),
				password: authValue.slice(slashIndex + 1),
			});
		});
	};

	// --------------------------------------------------------
	// makeNeo4jEdfiReader — the ONE bolt reader. Returns the reader contract shared with the
	// hermetic graph double: { readAll(callback), close(callback) }.
	//   readAll -> callback(errString, graphRows) where graphRows =
	//     { rootRow, constructRowList, propertyRowList, optionValueRowList, itemEdgeRowList,
	//       nodeCountByRole, edgeCountByType }
	// --------------------------------------------------------
	const makeNeo4jEdfiReader = ({ boltUrl, user, password, pageSize }) => {
		const neo4j = require('neo4j-driver');
		const effectivePageSize = pageSize || DEFAULT_PAGE_SIZE;
		const driver = neo4j.driver(boltUrl, neo4j.auth.basic(user, password), {
			encrypted: false,
			disableLosslessIntegers: true,
		});

		const runPagedNodeQuery = ({ roleList, projectionList }, pageCallback) => {
			const session = driver.session();
			const collectedRowList = [];
			const projectionText = projectionList.map((oneName) => `.${oneName}`).join(', ');
			const pageFrom = (cursorStableId) => {
				session
					.run(
						`MATCH (oneNode:ForgedNode {_source: $standardSource})
						 WHERE oneNode.role IN $roleList AND oneNode.stableId > $cursorStableId
						 RETURN oneNode { ${projectionText} } AS row
						 ORDER BY oneNode.stableId
						 LIMIT ${effectivePageSize}`,
						{ standardSource: STANDARD_SOURCE, roleList, cursorStableId },
					)
					.then((queryResult) => {
						const pageRowList = queryResult.records.map((oneRecord) => oneRecord.get('row'));
						pageRowList.forEach((oneRow) => collectedRowList.push(oneRow));
						if (pageRowList.length < effectivePageSize) {
							session.close();
							pageCallback('', collectedRowList);
							return;
						}
						pageFrom(pageRowList[pageRowList.length - 1].stableId);
					})
					.catch((queryError) => {
						session.close();
						pageCallback(`${moduleName} bolt node query (${roleList.join(',')}): ${queryError.message}`);
					});
			};
			pageFrom('');
		};

		const readAll = (callback) => {
			const taskList = new taskListPlus();

			taskList.push((args, next) => {
				runPagedNodeQuery(
					{ roleList: ['DmeStandardRoot'], projectionList: ROOT_READ_PROPERTY_LIST },
					(queryError, rowList) => {
						if (queryError) {
							next(queryError);
							return;
						}
						next('', { ...args, rootRow: rowList[0] });
					},
				);
			});

			taskList.push((args, next) => {
				runPagedNodeQuery(
					{ roleList: CONSTRUCT_ROLES, projectionList: CONSTRUCT_READ_PROPERTY_LIST },
					(queryError, rowList) => {
						if (queryError) {
							next(queryError);
							return;
						}
						next('', { ...args, constructRowList: rowList });
					},
				);
			});

			taskList.push((args, next) => {
				runPagedNodeQuery(
					{ roleList: ['DmeProperty'], projectionList: PROPERTY_READ_PROPERTY_LIST },
					(queryError, rowList) => {
						if (queryError) {
							next(queryError);
							return;
						}
						next('', { ...args, propertyRowList: rowList });
					},
				);
			});

			taskList.push((args, next) => {
				runPagedNodeQuery(
					{ roleList: ['DmeOptionValue'], projectionList: OPTION_VALUE_READ_PROPERTY_LIST },
					(queryError, rowList) => {
						if (queryError) {
							next(queryError);
							return;
						}
						next('', { ...args, optionValueRowList: rowList });
					},
				);
			});

			// domain items + interchange components exist ONLY as REFERENCES edges leaving
			// item-carrier constructs — both endpoint roles named explicitly (RT-4)
			taskList.push((args, next) => {
				const session = driver.session();
				session
					.run(
						`MATCH (fromNode:ForgedNode {_source: $standardSource})-[:REFERENCES]->(toNode:ForgedNode {_source: $standardSource})
						 WHERE fromNode.role = 'DmeSupport'
						   AND fromNode.constructType IN $itemCarrierList
						   AND toNode.role IN ['DmeClass', 'DmeOptionSet', 'DmeSupport']
						 RETURN fromNode.stableId AS fromStableId, fromNode.constructType AS fromConstructType,
						        fromNode.name AS fromName, toNode.name AS toName,
						        toNode.constructType AS toConstructType
						 ORDER BY fromStableId, toName`,
						{ standardSource: STANDARD_SOURCE, itemCarrierList: ITEM_CARRIER_CONSTRUCT_TYPES },
					)
					.then((queryResult) => {
						session.close();
						next('', {
							...args,
							itemEdgeRowList: queryResult.records.map((oneRecord) => ({
								fromStableId: oneRecord.get('fromStableId'),
								fromConstructType: oneRecord.get('fromConstructType'),
								fromName: oneRecord.get('fromName'),
								toName: oneRecord.get('toName'),
								toConstructType: oneRecord.get('toConstructType'),
							})),
						});
					})
					.catch((queryError) => {
						session.close();
						next(`${moduleName} bolt item-edge query: ${queryError.message}`);
					});
			});

			// graph identity counts for the verdict (scoped both endpoints)
			taskList.push((args, next) => {
				const session = driver.session();
				session
					.run(
						`MATCH (oneNode:ForgedNode {_source: $standardSource})
						 RETURN oneNode.role AS role, count(oneNode) AS nodeCount`,
						{ standardSource: STANDARD_SOURCE },
					)
					.then((nodeCountResult) => {
						const nodeCountByRole = {};
						nodeCountResult.records.forEach((oneRecord) => {
							nodeCountByRole[oneRecord.get('role')] = oneRecord.get('nodeCount');
						});
						return session
							.run(
								`MATCH (fromNode:ForgedNode {_source: $standardSource})-[oneEdge]->(toNode:ForgedNode {_source: $standardSource})
								 RETURN type(oneEdge) AS edgeType, count(oneEdge) AS edgeCount`,
								{ standardSource: STANDARD_SOURCE },
							)
							.then((edgeCountResult) => {
								session.close();
								const edgeCountByType = {};
								edgeCountResult.records.forEach((oneRecord) => {
									edgeCountByType[oneRecord.get('edgeType')] = oneRecord.get('edgeCount');
								});
								next('', { ...args, nodeCountByRole, edgeCountByType });
							});
					})
					.catch((queryError) => {
						session.close();
						next(`${moduleName} bolt count query: ${queryError.message}`);
					});
			});

			pipeRunner(taskList.getList(), {}, (pipelineError, args) => {
				if (pipelineError) {
					callback(pipelineError);
					return;
				}
				callback('', {
					rootRow: args.rootRow,
					constructRowList: args.constructRowList,
					propertyRowList: args.propertyRowList,
					optionValueRowList: args.optionValueRowList,
					itemEdgeRowList: args.itemEdgeRowList,
					nodeCountByRole: args.nodeCountByRole,
					edgeCountByType: args.edgeCountByType,
				});
			});
		};

		const close = (callback) => {
			driver
				.close()
				.then(() => callback(''))
				.catch((closeError) => callback(`${moduleName} driver close: ${closeError.message}`));
		};

		return { readAll, close };
	};

	// --------------------------------------------------------
	// emitGraphStatements — PURE: graphRows -> the graph side's canonical statements + the
	// R-WO-12 invention-guard stash + an emission census. A row this emitter cannot invert is a
	// CANONICALIZATION FAULT (fatal, named) — never a quiet skip.
	//   inputs:  { graphRows }
	//   returns { statementList, cedsStashList, emissionCensus } or { fault }
	// --------------------------------------------------------
	const emitGraphStatements = ({ graphRows }) => {
		const statementList = [];
		const cedsStashList = [];
		const emissionCensus = {
			constructStatementCount: 0,
			propertyStatementCount: 0,
			optionValueStatementCount: 0,
			itemStatementCount: 0,
			skippedParentEdgeCount: 0,
			skippedExtendeeEdgeCount: 0,
		};
		let faultMessage = '';

		const emit = (subject, predicate, objectValue, locatedDetail) => {
			statementList.push({
				subject,
				predicate,
				object: `${objectValue}`,
				sourceFileRelativePath: locatedDetail && locatedDetail.sourceFileRelativePath,
				sourceLineNumber: locatedDetail && locatedDetail.sourceLineNumber,
			});
		};

		const collectCrossRefRawValues = ({ rowStableId, crossRefsJsonText, cedsOptionCodeValue }) => {
			if (cedsOptionCodeValue !== undefined && cedsOptionCodeValue !== null) {
				cedsStashList.push({
					stableId: rowStableId,
					anchorKind: 'cedsOptionCode',
					rawValue: `${cedsOptionCodeValue}`,
				});
			}
			if (!crossRefsJsonText) {
				return;
			}
			let crossRefList;
			let parseFault = '';
			try {
				crossRefList = JSON.parse(crossRefsJsonText);
			} catch (thrownError) {
				parseFault = thrownError.message;
			}
			if (parseFault) {
				faultMessage =
					faultMessage ||
					`${moduleName}.emitGraphStatements FAULT: node '${rowStableId}' carries unparseable crossRefs JSON (${parseFault})`;
				return;
			}
			crossRefList.forEach((oneCrossRef) => {
				if (oneCrossRef.raw !== undefined) {
					cedsStashList.push({
						stableId: rowStableId,
						anchorKind: 'cedsGlobalId',
						rawValue: `${oneCrossRef.raw}`,
					});
				}
			});
		};

		// ---- constructs ----
		const constructRowByStableId = {};
		(graphRows.constructRowList || []).forEach((oneRow) => {
			constructRowByStableId[oneRow.stableId] = oneRow;
		});

		(graphRows.constructRowList || []).forEach((oneRow) => {
			if (faultMessage) {
				return;
			}
			if (!oneRow.constructType || !oneRow.name) {
				faultMessage = `${moduleName}.emitGraphStatements FAULT: construct row '${oneRow.stableId}' lacks constructType or name`;
				return;
			}
			const subject = `edfi://${oneRow.constructType}/${oneRow.name}`;
			const locatedDetail = oneRow;
			emit(subject, 'declaredAs', oneRow.constructType, locatedDetail);
			emissionCensus.constructStatementCount += 1;

			CONSTRUCT_SCALAR_EMISSION_REGISTRY.forEach(([scalarName, predicate, transformKind]) => {
				if (oneRow[scalarName] !== undefined && oneRow[scalarName] !== null) {
					const transformedValue = applyTransform(transformKind, oneRow[scalarName]);
					if (transformedValue === undefined) {
						faultMessage =
							faultMessage ||
							`${moduleName}.emitGraphStatements FAULT: construct '${oneRow.stableId}' field ` +
								`'${scalarName}' holds ${JSON.stringify(oneRow[scalarName])}, which the ` +
								`'${transformKind}' transform refuses — malformed graph data, never coerced`;
						return;
					}
					emit(subject, predicate, transformedValue, locatedDetail);
				}
			});

			if (SUBCLASS_CONSTRUCT_TYPES.includes(oneRow.constructType)) {
				emit(
					subject,
					'basedOn',
					qualifiedNameFor({ localName: oneRow.baseName, namespacePrefix: oneRow.baseNamespace }),
					locatedDetail,
				);
			}
			if (EXTENSION_CONSTRUCT_TYPES.includes(oneRow.constructType)) {
				emit(
					subject,
					'extends',
					qualifiedNameFor({
						localName: oneRow.extendeeName,
						namespacePrefix: oneRow.extendeeNamespace,
					}),
					locatedDetail,
				);
				if (oneRow.extendeeNamespace) {
					emit(subject, 'constructNamespace', oneRow.extendeeNamespace, locatedDetail);
				}
			}
			if (oneRow.constructType === 'subdomain') {
				emit(subject, 'subdomainOf', oneRow.parentDomainName, locatedDetail);
			}

			collectCrossRefRawValues({
				rowStableId: oneRow.stableId,
				crossRefsJsonText: oneRow.crossRefs,
			});
		});

		// ---- properties ----
		(graphRows.propertyRowList || []).forEach((oneRow) => {
			if (faultMessage) {
				return;
			}
			const sourceLocalName = oneRow.sharedPropertyName
				? oneRow.sharedPropertyName
				: SHARED_PROPERTY_TYPES.includes(oneRow.propertyType) && !oneRow.sharedPropertyName
					? oneRow.sharedTypeName
					: invertEffectivePropertyName({
							effectiveName: oneRow.name,
							roleNameName: oneRow.roleNameName,
						});
			if (sourceLocalName === undefined) {
				faultMessage =
					`${moduleName}.emitGraphStatements FAULT: property '${oneRow.stableId}' effective name ` +
					`'${oneRow.name}' cannot be inverted against roleNameName '${oneRow.roleNameName}' — ` +
					`uninvertible is a fault, never a guess`;
				return;
			}
			const ownerSubject = `edfi://${oneRow.owningConstructType}/${oneRow.owningConstructName}`;
			const subject = oneRow.roleNameName
				? `${ownerSubject}/property/${sourceLocalName}/roleName/${oneRow.roleNameName}`
				: `${ownerSubject}/property/${sourceLocalName}`;
			const locatedDetail = oneRow;
			emissionCensus.propertyStatementCount += 1;

			PROPERTY_SCALAR_EMISSION_REGISTRY.forEach(([scalarName, predicate, transformKind]) => {
				if (oneRow[scalarName] !== undefined && oneRow[scalarName] !== null) {
					const transformedValue = applyTransform(transformKind, oneRow[scalarName]);
					if (transformedValue === undefined) {
						faultMessage =
							faultMessage ||
							`${moduleName}.emitGraphStatements FAULT: property '${oneRow.stableId}' field ` +
								`'${scalarName}' holds ${JSON.stringify(oneRow[scalarName])}, which the ` +
								`'${transformKind}' transform refuses — malformed graph data, never coerced`;
						return;
					}
					emit(subject, predicate, transformedValue, locatedDetail);
				}
			});

			if (SHARED_PROPERTY_TYPES.includes(oneRow.propertyType)) {
				emit(
					subject,
					'sharedType',
					qualifiedNameFor({
						localName: oneRow.sharedTypeName,
						namespacePrefix: oneRow.sharedTypeNamespace,
					}),
					locatedDetail,
				);
			} else if (oneRow.propertyNamespace) {
				emit(subject, 'propertyNamespace', oneRow.propertyNamespace, locatedDetail);
			}

			if (oneRow.mergeDirectives) {
				let mergeDirectiveList;
				let parseFault = '';
				try {
					mergeDirectiveList = JSON.parse(oneRow.mergeDirectives);
				} catch (thrownError) {
					parseFault = thrownError.message;
				}
				if (parseFault) {
					faultMessage = `${moduleName}.emitGraphStatements FAULT: property '${oneRow.stableId}' carries unparseable mergeDirectives JSON (${parseFault})`;
					return;
				}
				mergeDirectiveList.forEach((oneDirective) => {
					emit(
						subject,
						'merge',
						`${oneDirective.sourcePropertyPath}|${oneDirective.targetPropertyPath}`,
						locatedDetail,
					);
				});
			}

			collectCrossRefRawValues({
				rowStableId: oneRow.stableId,
				crossRefsJsonText: oneRow.crossRefs,
			});
		});

		// ---- option values ----
		(graphRows.optionValueRowList || []).forEach((oneRow) => {
			if (faultMessage) {
				return;
			}
			const parentRef = parseConstructStableId(oneRow.parentId);
			if (!parentRef) {
				faultMessage = `${moduleName}.emitGraphStatements FAULT: option value '${oneRow.stableId}' parentId '${oneRow.parentId}' does not parse as a construct stableId`;
				return;
			}
			const trimmedValueText = `${oneRow.name}`.trim();
			const subject = `edfi://${parentRef.constructType}/${parentRef.constructName}/value/${trimmedValueText}`;
			const locatedDetail = oneRow;
			emissionCensus.optionValueStatementCount += 1;

			if (oneRow.valueOrigin === 'descriptorCodeValueXml') {
				emit(subject, 'codeValue', oneRow.name, locatedDetail);
				if (oneRow.shortDescription !== undefined && oneRow.shortDescription !== null) {
					emit(subject, 'shortDescription', collapseWhitespace(oneRow.shortDescription), locatedDetail);
				}
				if (oneRow.description !== undefined && oneRow.description !== null) {
					emit(subject, 'valueDescription', collapseWhitespace(oneRow.description), locatedDetail);
				}
				if (oneRow.namespace !== undefined && oneRow.namespace !== null) {
					emit(subject, 'namespace', collapseWhitespace(oneRow.namespace), locatedDetail);
				}
			} else if (['enumerationItem', 'mapTypeItem'].includes(oneRow.valueOrigin)) {
				emit(subject, 'itemOf', parentRef.constructName, locatedDetail);
				emit(subject, 'shortDescription', oneRow.name, locatedDetail);
				emit(subject, 'itemOrigin', oneRow.valueOrigin, locatedDetail);
				if (oneRow.description !== undefined && oneRow.description !== null) {
					emit(subject, 'documentation', collapseWhitespace(oneRow.description), locatedDetail);
				}
				if (oneRow.metaEdId !== undefined && oneRow.metaEdId !== null) {
					emit(subject, 'metaEdId', oneRow.metaEdId, locatedDetail);
				}
			} else {
				faultMessage = `${moduleName}.emitGraphStatements FAULT: option value '${oneRow.stableId}' carries unknown valueOrigin '${oneRow.valueOrigin}'`;
				return;
			}

			collectCrossRefRawValues({
				rowStableId: oneRow.stableId,
				crossRefsJsonText: oneRow.crossRefs,
				cedsOptionCodeValue: oneRow.cedsOptionCode,
			});
		});

		// ---- domain items + interchange components (edge-carried content) ----
		(graphRows.itemEdgeRowList || []).forEach((oneEdgeRow) => {
			if (faultMessage) {
				return;
			}
			const fromSubject = `edfi://${oneEdgeRow.fromConstructType}/${oneEdgeRow.fromName}`;
			if (['domain', 'subdomain'].includes(oneEdgeRow.fromConstructType)) {
				if (oneEdgeRow.toConstructType === 'domain') {
					// the subdomain's parent-domain edge — carried by the parentDomainName scalar
					emissionCensus.skippedParentEdgeCount += 1;
					return;
				}
				emit(fromSubject, 'hasItem', oneEdgeRow.toName, undefined);
				emissionCensus.itemStatementCount += 1;
				return;
			}
			// interchange / interchangeExtension
			if (['interchange'].includes(oneEdgeRow.toConstructType)) {
				// the extension's extendee edge — carried by the extendeeName scalar
				emissionCensus.skippedExtendeeEdgeCount += 1;
				return;
			}
			emit(fromSubject, 'hasComponent', oneEdgeRow.toName, undefined);
			emissionCensus.itemStatementCount += 1;
		});

		if (faultMessage) {
			return { fault: faultMessage };
		}
		return { statementList, cedsStashList, emissionCensus };
	};

	return {
		resolveContainerBolt,
		makeNeo4jEdfiReader,
		emitGraphStatements,
		invertEffectivePropertyName, // exported for the hermetic suite
		parseConstructStableId, // exported for the hermetic suite
		CONSTRUCT_READ_PROPERTY_LIST,
		PROPERTY_READ_PROPERTY_LIST,
		OPTION_VALUE_READ_PROPERTY_LIST,
		ROOT_READ_PROPERTY_LIST,
		STANDARD_SOURCE,
		DEFAULT_PAGE_SIZE,
	};
};

module.exports = moduleFunction;
