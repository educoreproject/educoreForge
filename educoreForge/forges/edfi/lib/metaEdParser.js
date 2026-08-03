'use strict';

// metaEdParser.js — the public entry point of the forge-edfi independent MetaEd parser
// (Phase 1, R-WO-3/R-WO-6). Composes the source loader, the lexer, and the syntax parser into
// one operation: pinned snapshot directory -> in-memory MetaEd model with census.
//
// The in-memory model shape (the formally declared interface of this module — Phase 2's forge
// consumes exactly this):
//
//   {
//     metadata: {
//       snapshotPath,
//       sourceInputs: [ { inputName, projectName, projectVersion, fileCount } ]
//     },
//     constructsByInput: {
//       <inputName>: [ construct, ... ]     // parse order: file path order within the input
//     },
//     census: {
//       constructCountsByInput: { <inputName>: { <constructType>: count } },
//       constructCounts: { <constructType>: count },     // both inputs combined
//       propertyCounts: { <propertyType>: count },       // all properties on all constructs
//       totalConstructCount, totalPropertyCount,
//       enumerationItemCount,                            // enumeration + descriptor map-type items
//       domainItemCount, interchangeComponentCount
//     },
//     constructNamesByType: { <constructType>: [sortedNameList] }   // census-delta raw material
//   }
//
// Construct and property object shapes are defined in metaEdSyntaxParser.js, one for one with
// the reference grammar's rules. Every construct carries sourceFileRelativePath and
// sourceLineNumber, so any downstream refusal can name its origin.
//
// Async style: qtools taskListPlus/pipeRunner; error-first callbacks (RT-8/R7); the first
// refusal from any stage aborts the pipeline and surfaces verbatim.

const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const metaEdSourceLoader = require('./metaEdSourceLoader')();
const metaEdLexer = require('./metaEdLexer')();
const metaEdSyntaxParser = require('./metaEdSyntaxParser')();

// name field per construct type — the census-delta name index reads the right property
const CONSTRUCT_NAME_FIELD_REGISTRY = {
	abstractEntity: 'entityName',
	association: 'associationName',
	associationExtension: 'extendeeName',
	associationSubclass: 'associationName',
	choice: 'choiceName',
	common: 'commonName',
	commonExtension: 'extendeeName',
	commonSubclass: 'commonName',
	descriptor: 'descriptorName',
	domain: 'domainName',
	domainEntity: 'entityName',
	domainEntityExtension: 'extendeeName',
	domainEntitySubclass: 'entityName',
	enumeration: 'enumerationName',
	inlineCommon: 'inlineCommonName',
	interchange: 'interchangeName',
	interchangeExtension: 'extendeeName',
	sharedDecimal: 'sharedDecimalName',
	sharedInteger: 'sharedIntegerName',
	sharedShort: 'sharedShortName',
	sharedString: 'sharedStringName',
	subdomain: 'subdomainName',
};

const incrementCount = (countRegistry, countedName) => {
	countRegistry[countedName] = (countRegistry[countedName] || 0) + 1;
};

const moduleFunction = () => {
	// --------------------------------------------------------
	// parseMetaEdSourceText — parse ONE source text (the hermetic-test entry; no filesystem).
	//   inputs:  { sourceText, sourceFileRelativePath }
	//   callback(errString, { constructList })
	// --------------------------------------------------------
	const parseMetaEdSourceText = ({ sourceText, sourceFileRelativePath }, callback) => {
		metaEdLexer.tokenizeMetaEdSource(
			{ sourceText, sourceFileRelativePath },
			(lexerError, lexerResult) => {
				if (lexerError) {
					callback(lexerError);
					return;
				}
				metaEdSyntaxParser.parseTokenList(
					{ tokenList: lexerResult.tokenList, sourceFileRelativePath },
					callback,
				);
			},
		);
	};

	// --------------------------------------------------------
	// parseMetaEdSnapshot — the full-snapshot operation.
	//   inputs:  { snapshotPath, xLog }   (xLog is optional progress logging, injected)
	//   callback(errString, metaEdInMemoryModel)
	// --------------------------------------------------------
	const parseMetaEdSnapshot = ({ snapshotPath, xLog }, callback) => {
		const progressLog = xLog || { status: () => {}, verbose: () => {} };
		const taskList = new taskListPlus();

		// STAGE 1 — load and checksum-verify the two .metaed source inputs (refusals inside)
		taskList.push((args, next) => {
			metaEdSourceLoader.loadMetaEdSourceFiles({ snapshotPath }, (loaderError, loaded) => {
				if (loaderError) {
					next(loaderError);
					return;
				}
				progressLog.status(
					`[forge-edfi metaEdParser] loaded ${loaded.sourceInputList
						.map((sourceInput) => `${sourceInput.inputName}: ${sourceInput.metaEdFileList.length} files`)
						.join(', ')}`,
				);
				next('', { ...args, sourceInputList: loaded.sourceInputList });
			});
		});

		// STAGE 2 — lex+parse every file of every input; first refusal aborts, naming its file
		taskList.push((args, next) => {
			const constructsByInput = {};
			const fileWorkQueue = [];
			args.sourceInputList.forEach((sourceInput) => {
				constructsByInput[sourceInput.inputName] = [];
				sourceInput.metaEdFileList.forEach((metaEdFileEntry) => {
					fileWorkQueue.push({ inputName: sourceInput.inputName, metaEdFileEntry });
				});
			});

			const parseNextQueuedFile = (queueIndex) => {
				if (queueIndex >= fileWorkQueue.length) {
					next('', { ...args, constructsByInput });
					return;
				}
				const { inputName, metaEdFileEntry } = fileWorkQueue[queueIndex];
				parseMetaEdSourceText(
					{
						sourceText: metaEdFileEntry.sourceText,
						sourceFileRelativePath: metaEdFileEntry.sourceFileRelativePath,
					},
					(parseError, parseResult) => {
						if (parseError) {
							next(parseError);
							return;
						}
						parseResult.constructList.forEach((parsedConstruct) => {
							constructsByInput[inputName].push({
								...parsedConstruct,
								sourceFileRelativePath: metaEdFileEntry.sourceFileRelativePath,
							});
						});
						// synchronous continuation is safe: the lexer/parser call back inline, and
						// 849 frames would overflow nothing because each callback returns before the
						// next file starts via this explicit tail call
						setImmediate(() => parseNextQueuedFile(queueIndex + 1));
					},
				);
			};
			parseNextQueuedFile(0);
		});

		// STAGE 3 — assemble model, census, and the name index
		taskList.push((args, next) => {
			const constructCountsByInput = {};
			const constructCounts = {};
			const propertyCounts = {};
			const constructNamesByType = {};
			let totalConstructCount = 0;
			let totalPropertyCount = 0;
			let enumerationItemCount = 0;
			let domainItemCount = 0;
			let interchangeComponentCount = 0;

			Object.entries(args.constructsByInput).forEach(([inputName, constructList]) => {
				constructCountsByInput[inputName] = {};
				constructList.forEach((parsedConstruct) => {
					totalConstructCount += 1;
					incrementCount(constructCountsByInput[inputName], parsedConstruct.constructType);
					incrementCount(constructCounts, parsedConstruct.constructType);

					const nameField = CONSTRUCT_NAME_FIELD_REGISTRY[parsedConstruct.constructType];
					const constructName = nameField && parsedConstruct[nameField];
					if (constructName) {
						(constructNamesByType[parsedConstruct.constructType] =
							constructNamesByType[parsedConstruct.constructType] || []).push(constructName);
					}

					(parsedConstruct.propertyList || []).forEach((parsedProperty) => {
						totalPropertyCount += 1;
						incrementCount(propertyCounts, parsedProperty.propertyType);
					});
					// association defining domain entities are reference slots, not propertyList
					// members, per the grammar; census them as properties of type 'definingDomainEntity'
					(parsedConstruct.definingDomainEntityList || []).forEach(() => {
						totalPropertyCount += 1;
						incrementCount(propertyCounts, 'definingDomainEntity');
					});
					enumerationItemCount += (parsedConstruct.enumerationItemList || []).length;
					enumerationItemCount += (parsedConstruct.mapTypeItemList || []).length;
					domainItemCount += (parsedConstruct.domainItemList || []).length;
					interchangeComponentCount += (parsedConstruct.interchangeComponentList || []).length;
				});
			});

			Object.values(constructNamesByType).forEach((nameList) => nameList.sort());

			const metaEdInMemoryModel = {
				metadata: {
					snapshotPath,
					sourceInputs: args.sourceInputList.map((sourceInput) => ({
						inputName: sourceInput.inputName,
						projectName: sourceInput.projectName,
						projectVersion: sourceInput.projectVersion,
						fileCount: sourceInput.metaEdFileList.length,
					})),
				},
				constructsByInput: args.constructsByInput,
				census: {
					constructCountsByInput,
					constructCounts,
					propertyCounts,
					totalConstructCount,
					totalPropertyCount,
					enumerationItemCount,
					domainItemCount,
					interchangeComponentCount,
				},
				constructNamesByType,
			};
			next('', { ...args, metaEdInMemoryModel });
		});

		pipeRunner(taskList.getList(), {}, (pipelineError, args) => {
			if (pipelineError) {
				callback(pipelineError);
				return;
			}
			callback('', args.metaEdInMemoryModel);
		});
	};

	return { parseMetaEdSnapshot, parseMetaEdSourceText };
};

module.exports = moduleFunction;
