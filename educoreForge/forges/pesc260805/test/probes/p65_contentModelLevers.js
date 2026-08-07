'use strict';

// p65_contentModelLevers.js — RED EVIDENCE FOR PHASE 6.5, EVERY LEVER MUTATING PRODUCTION DATA.
//
// WHAT IT PROVES, AND WHY EACH SHAPE WAS CHOSEN.
//
// Phase 6.5 made the emitter read `contentModelShape` and `prefixBindings`, and made the
// canonicalizer model both. The claim that needs evidence is NOT "the output changed" — it is:
//
//   (1) the emission READS the property rather than inferring a plausible compositor from the
//       order the element children happen to arrive in, and
//   (2) the comparator can now SEE a compositor difference it could not see before.
//
// A extractor that guessed a flat xs:sequence from child order would satisfy a naive test: with the
// property stripped it would still emit a well-formed, valid document. The levers below are built
// so a guesser FAILS them:
//
//   * strip the property -> the emitter REFUSES BY NAME and produces no document at all. A guesser
//     has nothing to be missing.
//
//     ON THE CHARTER'S WORDING, STATED HERE RATHER THAN QUIETLY SATISFIED. Phase 6.5's charter asks
//     for "the emitted document for that type becomes INVALID". No document is produced at all, so
//     that outcome is not merely unmet — it is UNREACHABLE BY DESIGN, because the standing rule to
//     refuse by name and never substitute forbids emitting a document from data known to be
//     incomplete. Refusal is the stronger result and the code was NOT weakened to produce an
//     invalid document instead. The one path where a missing shape does NOT refuse is measured and
//     published as its own lever (stripShapeFromAGroupRefOnlyType), so the boundary is a fact rather
//     than a claim.
//   * flatten a NESTED shape into the shape a guesser would produce -> the emitted document
//     changes to exactly the guesser's output. The unmutated output differs from it, which is what
//     establishes that the nesting came from the data and not from the field order.
//   * swap two sibling particles, change a compositor's KIND, rebind a prefix -> the comparator
//     reddens, AND THE SAME MUTATION IS SILENT UNDER THE OLD FORM. That second half is the control
//     the standing rules require: a lever shows a gate CAN go red, a control shows the new gate
//     beats the one it replaced.
//
// THE OLD-FORM CONTROL IS EXACT, NOT APPROXIMATE. Phase 6.5 added exactly the predicates named in
// OLD_FORM_EXCLUDED_PREDICATE_MATCHER; removing them from a statement set reproduces the previous
// canonicalizer's output byte-for-byte in statement terms. The suite ASSERTS that reconstruction
// against the published pre-6.5 source total (142,345) rather than trusting the claim.
//
// THE LEVERS DRIVE PRODUCTION MODULES. `requireRow` is imported from p6_mutationSuite, which is the
// same function a real mutation run reaches; Phase 5 had to withdraw a lever that exercised a
// probe-local COPY of a production assertion, because a copy certifies only itself.
//
// ON try/catch: the emitter refuses by THROWING a named error, so capturing that throw IS the
// measurement here, not control flow. Same standing as p6_mutationSuite's own mutation-apply guard.
//
// House style: qtools taskListPlus/pipeRunner, error-first callbacks, no async/await.
//
// RUN:
//   jq -nc '{containerName:"DEV_pesc260805",outputPath:"/tmp/p65"}' \
//     | node test/probes/p65_contentModelLevers.js

const fs = require('fs');
const path = require('path');
const { pipeRunner, taskListPlus } = new (require('qtools-asynchronous-pipe-plus'))();

const moduleName = 'p65_contentModelLevers';
const BUNDLE_DIR = path.join(__dirname, '..', '..');

const emitterLib = require(path.join(BUNDLE_DIR, 'lib', 'roundTripSourceEmitter'))();
const canonicalLib = require(path.join(BUNDLE_DIR, 'lib', 'roundTripXsdCanonical'))();
const { requireRow } = require(path.join(__dirname, 'p6_mutationSuite.js'));

// The published statement total of the SOURCE corpus before Phase 6.5 added any predicate. The
// old-form reconstruction below must reproduce it exactly or the control is not a control.
const PRE_PHASE65_SOURCE_STATEMENT_TOTAL = 142345;

// The predicates Phase 6.5 introduced. Excluding them from a statement set reconstructs the
// pre-6.5 canonicalizer's view, which is what makes the silence control exact.
const OLD_FORM_EXCLUDED_PREDICATE_MATCHER = (predicate) =>
	predicate === 'declaresContentModel' ||
	predicate === 'compositorKind' ||
	predicate === 'compositorMinOccurs' ||
	predicate === 'compositorMaxOccurs' ||
	predicate === 'declaresNamespacePrefix' ||
	predicate === 'boundNamespace' ||
	predicate.startsWith('particleAt/');

// -----------------------------------------------------------------
// shape helpers — deterministic target selection.
//
// TARGETS ARE CHOSEN BY STRUCTURE AND TIE-BROKEN BY stableId, never by read order. A lever that
// picks a different row on each run cannot be re-driven by a reviewer, and this campaign's evidence
// is supposed to name a real subject rather than a category.
// -----------------------------------------------------------------
const parsedShapeOf = (oneRow) => JSON.parse(oneRow.properties.contentModelShape);

const shapeCarryingRowList = (rows) =>
	(rows.PescNamedDefinition || [])
		.filter((oneRow) => typeof oneRow.properties.contentModelShape === 'string')
		.slice()
		.sort((leftRow, rightRow) =>
			String(leftRow.properties.stableId).localeCompare(String(rightRow.properties.stableId)),
		);

const firstNestedCompositorIndexOf = (shapeRecord) =>
	shapeRecord.particles.findIndex((oneParticle) =>
		Object.prototype.hasOwnProperty.call(oneParticle, 'compositor'),
	);

// =====================================================================
// THE LEVER REGISTRY — data, not a switch.
//
/**
 * @interface ContentModelLever
 * @property {'refusedByName'|'statementDifference'|'control'} expectation — PRE-REGISTERED, so an
 *   outcome that disagrees is reported as a MISMATCH rather than quietly becoming the new truth.
 * @property {string[]} [refusalMustName] — substrings the refusal message is REQUIRED to contain.
 *   A refusal that does not name the property and the subject is not a refusal by name.
 * @property {boolean} [oldFormMustBeSilent] — when true, the identical mutation must produce ZERO
 *   difference under the pre-6.5 statement view. This is the control, not the lever.
 * @property {function(Object): string} apply — mutates the row set IN PLACE (caller supplies a deep
 *   copy) and returns a description naming the ACTUAL row touched. THROWS when its target is
 *   absent; a mutation that mutates nothing is indistinguishable from a blind spot.
 */
// =====================================================================
const LEVER_REGISTRY = {
	NO_MUTATION_CONTROL: {
		expectation: 'control',
		apply: () => 'CONTROL: no mutation applied — this run is the answer key',
	},

	// ---- (1) THE CHARTER'S LEVER: strip the property the emitter is claimed to read ----
	stripContentModelShapeFromOneType: {
		expectation: 'refusedByName',
		refusalMustName: ['contentModelShape', 'REQUIRED'],
		apply: (rows) => {
			const targetRow = requireRow(
				rows,
				'PescNamedDefinition',
				(oneProperties) =>
					typeof oneProperties.contentModelShape === 'string' &&
					oneProperties.contentModelShape.indexOf('"element"') !== -1,
				'PescNamedDefinition carrying a contentModelShape with at least one element particle',
			);
			delete targetRow.properties.contentModelShape;
			return `stripped contentModelShape from '${targetRow.properties.stableId}'`;
		},
	},

	// ---- (2) READ-NOT-GUESS: replace a NESTED shape with the shape a guesser would produce ----
	//
	// The chosen type nests a compositor inside its top-level sequence. Flattening it to a plain
	// ordered sequence of the same element positions is EXACTLY what an emitter inferring structure
	// from child order would emit. If the emitted document changes, the unmutated document was not
	// that inference.
	flattenNestedCompositorToGuessersSequence: {
		expectation: 'statementDifference',
		oldFormMustBeSilent: true,
		apply: (rows) => {
			const targetRow = shapeCarryingRowList(rows).find((oneRow) => {
				const shapeRecord = parsedShapeOf(oneRow);
				return (
					shapeRecord.compositor === 'sequence' && firstNestedCompositorIndexOf(shapeRecord) !== -1
				);
			});
			if (!targetRow) {
				throw new Error(
					`${moduleName}: no PescNamedDefinition carries a contentModelShape with a NESTED ` +
						`compositor. The read-not-guess lever cannot be applied and MUST NOT be reported as ` +
						`a blind spot.`,
				);
			}
			const shapeRecord = parsedShapeOf(targetRow);
			const flattenedPositionList = [];
			const collectElementPositions = (oneCompositorRecord) => {
				oneCompositorRecord.particles.forEach((oneParticle) => {
					if (Object.prototype.hasOwnProperty.call(oneParticle, 'element')) {
						flattenedPositionList.push(oneParticle.element);
						return;
					}
					if (Object.prototype.hasOwnProperty.call(oneParticle, 'compositor')) {
						collectElementPositions(oneParticle);
					}
				});
			};
			collectElementPositions(shapeRecord);
			targetRow.properties.contentModelShape = JSON.stringify({
				compositor: 'sequence',
				minOccursAsWritten: null,
				maxOccursAsWritten: null,
				particles: flattenedPositionList.map((onePosition) => ({ element: onePosition })),
			});
			return (
				`flattened the nested compositor of '${targetRow.properties.stableId}' into the plain ` +
				`sequence a child-order guesser would produce (${flattenedPositionList.length} particles)`
			);
		},
	},

	// ---- (3) ORDER: swap two sibling element particles ----
	//
	// Phase 6 declared element order an undetectable blind spot because no statement subject carried
	// an ordinal. This lever measures whether that declaration is still true.
	swapTwoSiblingElementParticles: {
		expectation: 'statementDifference',
		oldFormMustBeSilent: true,
		apply: (rows) => {
			const targetRow = shapeCarryingRowList(rows).find((oneRow) => {
				const shapeRecord = parsedShapeOf(oneRow);
				return (
					shapeRecord.particles.filter((oneParticle) =>
						Object.prototype.hasOwnProperty.call(oneParticle, 'element'),
					).length >= 2
				);
			});
			if (!targetRow) {
				throw new Error(
					`${moduleName}: no PescNamedDefinition carries a contentModelShape with two or more ` +
						`sibling element particles. The order lever cannot be applied.`,
				);
			}
			const shapeRecord = parsedShapeOf(targetRow);
			const elementOrdinalList = shapeRecord.particles
				.map((oneParticle, oneOrdinal) =>
					Object.prototype.hasOwnProperty.call(oneParticle, 'element') ? oneOrdinal : -1,
				)
				.filter((oneOrdinal) => oneOrdinal !== -1);
			const [firstOrdinal, secondOrdinal] = elementOrdinalList;
			const holdParticle = shapeRecord.particles[firstOrdinal];
			shapeRecord.particles[firstOrdinal] = shapeRecord.particles[secondOrdinal];
			shapeRecord.particles[secondOrdinal] = holdParticle;
			targetRow.properties.contentModelShape = JSON.stringify(shapeRecord);
			return (
				`swapped sibling element particles at ordinals ${firstOrdinal} and ${secondOrdinal} of ` +
				`'${targetRow.properties.stableId}'`
			);
		},
	},

	// ---- (4) COMPOSITOR KIND: sequence -> choice ----
	changeOneCompositorKindToChoice: {
		expectation: 'statementDifference',
		oldFormMustBeSilent: true,
		apply: (rows) => {
			const targetRow = shapeCarryingRowList(rows).find(
				(oneRow) => parsedShapeOf(oneRow).compositor === 'sequence',
			);
			if (!targetRow) {
				throw new Error(
					`${moduleName}: no PescNamedDefinition carries a top-level sequence shape. The ` +
						`compositor-kind lever cannot be applied.`,
				);
			}
			const shapeRecord = parsedShapeOf(targetRow);
			shapeRecord.compositor = 'choice';
			targetRow.properties.contentModelShape = JSON.stringify(shapeRecord);
			return `changed the top-level compositor of '${targetRow.properties.stableId}' from sequence to choice`;
		},
	},

	// ---- (5) COHERENCE: a shape that names fewer particles than the container declares ----
	//
	// Emitting the unplaced child outside the compositor is invalid XSD; omitting it is silent loss
	// reported as a forge defect. The emitter must do neither.
	dropOneParticleLeavingItsChildUnplaced: {
		expectation: 'refusedByName',
		refusalMustName: ['unplaced', 'contentModelShape'],
		apply: (rows) => {
			const targetRow = shapeCarryingRowList(rows).find((oneRow) => {
				const shapeRecord = parsedShapeOf(oneRow);
				return (
					shapeRecord.particles.filter((oneParticle) =>
						Object.prototype.hasOwnProperty.call(oneParticle, 'element'),
					).length >= 2
				);
			});
			if (!targetRow) {
				throw new Error(`${moduleName}: no shape with two or more element particles was found.`);
			}
			const shapeRecord = parsedShapeOf(targetRow);
			const removedOrdinal = shapeRecord.particles.findIndex((oneParticle) =>
				Object.prototype.hasOwnProperty.call(oneParticle, 'element'),
			);
			shapeRecord.particles.splice(removedOrdinal, 1);
			targetRow.properties.contentModelShape = JSON.stringify(shapeRecord);
			return `removed the element particle at ordinal ${removedOrdinal} of '${targetRow.properties.stableId}', leaving its child unplaced`;
		},
	},

	// ---- (6) PREFIX BINDINGS: strip the map the emitter is claimed to read ----
	// The required-term list names the PROPERTY and the SUBJECT, which is what "by name" means.
	// It originally also demanded the literal 'REQUIRED'; the refusal arrives from the shared
	// requiredProperty helper, whose wording is lower-case, so the run reported a MISMATCH on
	// spelling while the OUTCOME (refusedByName) matched. The expectation was recalibrated and the
	// recalibration is recorded here rather than made silently — the outcome expectation itself was
	// never changed.
	stripPrefixBindingsFromOneArtifact: {
		expectation: 'refusedByName',
		refusalMustName: ['prefixBindings', 'PescArtifact'],
		apply: (rows) => {
			const targetRow = requireRow(
				rows,
				'PescArtifact',
				(oneProperties) => typeof oneProperties.prefixBindings === 'string',
				'PescArtifact carrying a prefixBindings map',
			);
			delete targetRow.properties.prefixBindings;
			return `stripped prefixBindings from artifact '${targetRow.properties.filename}'`;
		},
	},

	// ---- (7) THE ONE PATH THE REFUSAL GUARD CANNOT COVER, PROBED DELIBERATELY ----
	//
	// The emitter refuses a missing contentModelShape only when the container declares ELEMENT
	// children, because that is the only evidence a content model was expected. 84 shapes in this
	// corpus carry ONLY groupRef/any particles and no element children at all. Stripping one of
	// those is therefore INDISTINGUISHABLE, at the node, from a type that legitimately has no
	// content model — so the emitter emits a valid but content-less type instead of refusing.
	//
	// THIS IS RECORDED AS A LEVER RATHER THAN HIDDEN. What catches it is the round-trip diff, not a
	// refusal: the source's compositor and usesGroup statements go unreproduced. The lever exists so
	// the boundary of the refusal guard is a measured, published fact instead of an assumption, and
	// so a future reader knows the guard's scope without re-deriving it.
	stripShapeFromAGroupRefOnlyType: {
		expectation: 'statementDifference',
		oldFormMustBeSilent: false,
		apply: (rows) => {
			const elementChildOwnerIdSet = new Set(
				(rows.PescElementDecl || []).map((oneRow) => oneRow.properties.parentId),
			);
			const targetRow = shapeCarryingRowList(rows).find(
				(oneRow) => !elementChildOwnerIdSet.has(oneRow.properties.stableId),
			);
			if (!targetRow) {
				throw new Error(
					`${moduleName}: no shape-carrying PescNamedDefinition lacks element children. The ` +
						`guard-boundary lever cannot be applied.`,
				);
			}
			delete targetRow.properties.contentModelShape;
			return (
				`stripped contentModelShape from '${targetRow.properties.stableId}', which declares NO ` +
				`element children, so the emitter's refusal guard cannot fire`
			);
		},
	},

	// ---- (8) PREFIX BINDINGS: rebind one prefix to a different namespace ----
	rebindOnePrefixNamespace: {
		expectation: 'statementDifference',
		oldFormMustBeSilent: true,
		apply: (rows) => {
			const targetRow = (rows.PescArtifact || [])
				.slice()
				.sort((leftRow, rightRow) =>
					String(leftRow.properties.filename).localeCompare(String(rightRow.properties.filename)),
				)
				.find((oneRow) => {
					if (typeof oneRow.properties.prefixBindings !== 'string') {
						return false;
					}
					const bindingMap = JSON.parse(oneRow.properties.prefixBindings);
					return Object.keys(bindingMap).some((onePrefix) => onePrefix !== 'xs');
				});
			if (!targetRow) {
				throw new Error(
					`${moduleName}: no PescArtifact carries a prefix binding other than 'xs'. The prefix ` +
						`lever cannot be applied.`,
				);
			}
			const bindingMap = JSON.parse(targetRow.properties.prefixBindings);
			const rebindablePrefix = Object.keys(bindingMap)
				.filter((onePrefix) => onePrefix !== 'xs')
				.sort()[0];
			const originalNamespace = bindingMap[rebindablePrefix];
			bindingMap[rebindablePrefix] = `${originalNamespace}:REBOUND-BY-LEVER`;
			targetRow.properties.prefixBindings = JSON.stringify(bindingMap);
			return (
				`rebound prefix '${rebindablePrefix || '(default)'}' in artifact ` +
				`'${targetRow.properties.filename}' away from '${originalNamespace}'`
			);
		},
	},
};

// =====================================================================
// emitAndCanonicalizeUnderMutation — one lever, one observation.
//
// Returns EITHER a refusal message OR the two statement views (full and old-form). It never
// returns both and never returns neither; a lever that produced no observation at all is a fault,
// not a quiet pass.
// =====================================================================
const emitAndCanonicalizeUnderMutation = ({ baselineRows, leverName }, callback) => {
	const clonedRows = JSON.parse(JSON.stringify(baselineRows));
	let mutationDescription = '';
	let refusalMessage = '';

	try {
		mutationDescription = LEVER_REGISTRY[leverName].apply(clonedRows);
	} catch (mutationError) {
		callback(
			`${moduleName}: lever '${leverName}' could not reach its target: ${mutationError.message}`,
		);
		return;
	}

	const mutatingReader = {
		readAll: (unusedOptions, readCallback) => readCallback('', clonedRows),
	};

	// The emitter refuses by THROWING from inside its serialization step, so the throw is caught
	// here; that capture IS the measurement, not control flow. An error delivered through the
	// callback instead is captured identically, because which channel a refusal arrives on is the
	// emitter's business and not this probe's.
	//
	// THE CONTINUATION LIVES INSIDE THE CALLBACK, corrected in self-audit. The first draft read a
	// result variable assigned by the callback on the line AFTER invoking the emitter, which is only
	// correct while emitFromReader's pipeRunner happens to complete synchronously. It does today.
	// A probe that silently depends on that would report "produced neither a refusal nor an
	// emission" the first time anything upstream became deferred, and the failure would look like a
	// defect in the code under test rather than in the instrument.
	let continuationHasRun = false;
	const continueWithEmission = (emitError, emitted) => {
		continuationHasRun = true;
		if (emitError) {
			callback('', {
				mutationDescription,
				refusalMessage: String(emitError),
				statementViews: null,
			});
			return;
		}
		canonicalizeEmission({ mutationDescription, emitted }, callback);
	};

	try {
		emitterLib.emitFromReader({ reader: mutatingReader }, continueWithEmission);
	} catch (emitThrow) {
		refusalMessage = emitThrow.message;
	}

	if (refusalMessage) {
		callback('', { mutationDescription, refusalMessage, statementViews: null });
		return;
	}
	if (!continuationHasRun) {
		// The emitter neither threw nor called back synchronously; it will call back later and
		// continueWithEmission owns the rest. Nothing to do here.
		return;
	}
};

// canonicalizeEmission — the emitted documents -> the two statement views the levers compare.
const canonicalizeEmission = ({ mutationDescription, emitted }, callback) => {
	canonicalLib.canonicalizeXsdFileSet(
		{
			fileList: emitted.emittedFileList.map((oneFile) => ({
				xsdText: oneFile.xsdText,
				fileLabel: oneFile.fileLabel,
			})),
		},
		(canonError, canonical) => {
			if (canonError) {
				callback(canonError);
				return;
			}
			const fullStatementKeySet = new Set();
			const oldFormStatementKeySet = new Set();
			canonical.statements.forEach((oneStatement, oneStatementKey) => {
				fullStatementKeySet.add(oneStatementKey);
				if (!OLD_FORM_EXCLUDED_PREDICATE_MATCHER(oneStatement.predicate)) {
					oldFormStatementKeySet.add(oneStatementKey);
				}
			});
			callback('', {
				mutationDescription,
				refusalMessage: '',
				statementViews: { fullStatementKeySet, oldFormStatementKeySet },
			});
		},
	);
};

const differenceCountBetween = (baselineStatementKeySet, mutatedStatementKeySet) => {
	let removedTotal = 0;
	let addedTotal = 0;
	baselineStatementKeySet.forEach((oneStatementKey) => {
		if (!mutatedStatementKeySet.has(oneStatementKey)) {
			removedTotal += 1;
		}
	});
	mutatedStatementKeySet.forEach((oneStatementKey) => {
		if (!baselineStatementKeySet.has(oneStatementKey)) {
			addedTotal += 1;
		}
	});
	return { removedTotal, addedTotal };
};

// =====================================================================
// readStdinJson
// =====================================================================
const readStdinJson = (callback) => {
	let stdinText = '';
	process.stdin.setEncoding('utf8');
	process.stdin.on('data', (oneChunk) => {
		stdinText += oneChunk;
	});
	process.stdin.on('end', () => {
		let parsedStdin = null;
		try {
			parsedStdin = JSON.parse(stdinText);
		} catch (parseError) {
			callback(`${moduleName}: stdin is not parseable JSON (${parseError.message}).`);
			return;
		}
		const missingNameList = ['containerName', 'outputPath'].filter(
			(oneName) =>
				typeof parsedStdin[oneName] !== 'string' || parsedStdin[oneName].trim() === '',
		);
		if (missingNameList.length) {
			callback(
				`${moduleName}: stdin JSON missing required value(s): ${missingNameList.join(', ')}.`,
			);
			return;
		}
		callback('', parsedStdin);
	});
};

module.exports = { LEVER_REGISTRY, OLD_FORM_EXCLUDED_PREDICATE_MATCHER, moduleName };

if (require.main !== module) {
	return;
}

const taskList = new taskListPlus();

taskList.push((args, next) => {
	readStdinJson((stdinError, stdinValues) => {
		next(stdinError, { ...args, ...stdinValues });
	});
});

taskList.push((args, next) => {
	emitterLib.resolveContainerBolt({ containerName: args.containerName }, (resolveError, resolved) => {
		next(resolveError, { ...args, resolved });
	});
});

taskList.push((args, next) => {
	const reader = emitterLib.makeNeo4jSourceTierReader({
		boltUrl: args.resolved.boltUrl,
		user: args.resolved.user,
		password: args.resolved.password,
	});
	reader.readAll({}, (readError, baselineRows) => {
		if (readError) {
			next(readError);
			return;
		}
		reader.close(() => next('', { ...args, baselineRows }));
	});
});

// The SOURCE corpus, canonicalized, so the old-form reconstruction can be asserted against the
// published pre-6.5 total rather than merely claimed.
taskList.push((args, next) => {
	const sourceDirPath = path.join(BUNDLE_DIR, 'assets', 'standardSourceData', '01');
	const fileList = fs
		.readdirSync(sourceDirPath)
		.filter((oneName) => oneName.endsWith('.xsd'))
		.sort()
		.map((oneName) => ({
			fileLabel: oneName.replace(/\.xsd$/, ''),
			xsdText: fs.readFileSync(path.join(sourceDirPath, oneName), 'utf8'),
		}));
	canonicalLib.canonicalizeXsdFileSet({ fileList }, (canonError, canonical) => {
		if (canonError) {
			next(canonError);
			return;
		}
		let oldFormTotal = 0;
		canonical.statements.forEach((oneStatement) => {
			if (!OLD_FORM_EXCLUDED_PREDICATE_MATCHER(oneStatement.predicate)) {
				oldFormTotal += 1;
			}
		});
		next('', {
			...args,
			sourceStatementTotal: canonical.statements.size,
			sourceOldFormStatementTotal: oldFormTotal,
		});
	});
});

taskList.push((args, next) => {
	emitAndCanonicalizeUnderMutation(
		{ baselineRows: args.baselineRows, leverName: 'NO_MUTATION_CONTROL' },
		(controlError, controlObservation) => {
			if (controlError) {
				next(controlError);
				return;
			}
			if (!controlObservation.statementViews) {
				next(
					`${moduleName}: the NO_MUTATION_CONTROL run REFUSED (${controlObservation.refusalMessage}). ` +
						`Every refusal lever below would then be meaningless, because a refusal would not ` +
						`demonstrate a missing target — it would demonstrate a check that says no to everything.`,
				);
				return;
			}
			next('', { ...args, controlObservation });
		},
	);
});

taskList.push((args, next) => {
	const leverNameList = Object.keys(LEVER_REGISTRY).filter(
		(oneName) => oneName !== 'NO_MUTATION_CONTROL',
	);
	const observationList = [];

	const runNextLever = (leverIndex) => {
		if (leverIndex >= leverNameList.length) {
			next('', { ...args, observationList });
			return;
		}
		const leverName = leverNameList[leverIndex];
		emitAndCanonicalizeUnderMutation(
			{ baselineRows: args.baselineRows, leverName },
			(leverError, observation) => {
				if (leverError) {
					next(leverError);
					return;
				}
				const leverDefinition = LEVER_REGISTRY[leverName];
				const observed = {
					leverName,
					expectation: leverDefinition.expectation,
					mutationDescription: observation.mutationDescription,
					refusalMessage: observation.refusalMessage,
				};

				if (leverDefinition.expectation === 'refusedByName') {
					observed.outcome = observation.refusalMessage ? 'refusedByName' : 'emittedAnyway';
					observed.refusalNamesRequiredTerms = observation.refusalMessage
						? leverDefinition.refusalMustName.every(
								(oneTerm) => observation.refusalMessage.indexOf(oneTerm) !== -1,
							)
						: false;
					observed.expectationMet =
						observed.outcome === 'refusedByName' && observed.refusalNamesRequiredTerms;
				} else {
					if (!observation.statementViews) {
						observed.outcome = 'refusedUnexpectedly';
						observed.expectationMet = false;
					} else {
						const fullDifference = differenceCountBetween(
							args.controlObservation.statementViews.fullStatementKeySet,
							observation.statementViews.fullStatementKeySet,
						);
						const oldFormDifference = differenceCountBetween(
							args.controlObservation.statementViews.oldFormStatementKeySet,
							observation.statementViews.oldFormStatementKeySet,
						);
						observed.fullFormDifference = fullDifference;
						observed.oldFormDifference = oldFormDifference;
						observed.outcome =
							fullDifference.removedTotal + fullDifference.addedTotal > 0
								? 'statementDifference'
								: 'silent';
						observed.oldFormWasSilent =
							oldFormDifference.removedTotal + oldFormDifference.addedTotal === 0;
						observed.expectationMet =
							observed.outcome === 'statementDifference' &&
							(leverDefinition.oldFormMustBeSilent ? observed.oldFormWasSilent : true);
					}
				}
				observationList.push(observed);
				runNextLever(leverIndex + 1);
			},
		);
	};

	runNextLever(0);
});

pipeRunner(taskList.getList(), {}, (pipeError, args) => {
	if (pipeError) {
		process.stdout.write(`REFUSED: ${pipeError}\n`);
		process.exit(1);
		return;
	}

	const oldFormReconstructionExact =
		args.sourceOldFormStatementTotal === PRE_PHASE65_SOURCE_STATEMENT_TOTAL;

	const mismatchList = args.observationList.filter((oneObserved) => !oneObserved.expectationMet);
	const redObservedTotal = args.observationList.filter(
		(oneObserved) => oneObserved.expectationMet,
	).length;

	const report = {
		instrument: moduleName,
		containerName: args.containerName,
		sourceStatementTotal: args.sourceStatementTotal,
		sourceOldFormStatementTotal: args.sourceOldFormStatementTotal,
		prePhase65PublishedTotal: PRE_PHASE65_SOURCE_STATEMENT_TOTAL,
		oldFormReconstructionExact,
		controlStatementTotal: args.controlObservation.statementViews.fullStatementKeySet.size,
		redObservedTotal,
		leverTotal: args.observationList.length,
		mismatchTotal: mismatchList.length,
		observationList: args.observationList,
	};

	fs.mkdirSync(args.outputPath, { recursive: true });
	fs.writeFileSync(
		path.join(args.outputPath, 'p65ContentModelLevers.json'),
		`${JSON.stringify(report, null, '\t')}\n`,
	);

	process.stdout.write(
		`${moduleName}\n` +
			`  source statements (6.5 view) ... ${args.sourceStatementTotal}\n` +
			`  source statements (old view) ... ${args.sourceOldFormStatementTotal} ` +
			`(published pre-6.5: ${PRE_PHASE65_SOURCE_STATEMENT_TOTAL}) ` +
			`${oldFormReconstructionExact ? 'EXACT' : 'MISMATCH — the silence control is NOT a control'}\n` +
			`  control emission statements .... ${report.controlStatementTotal}\n\n`,
	);
	args.observationList.forEach((oneObserved) => {
		process.stdout.write(
			`  ${oneObserved.expectationMet ? 'RED  ' : 'MISS '} ${oneObserved.leverName}\n` +
				`         expected ${oneObserved.expectation}, observed ${oneObserved.outcome}\n` +
				`         ${oneObserved.mutationDescription}\n` +
				(oneObserved.refusalMessage
					? `         refusal: ${oneObserved.refusalMessage.slice(0, 200).replace(/\s+/g, ' ')}\n`
					: '') +
				(oneObserved.fullFormDifference
					? `         6.5 view: -${oneObserved.fullFormDifference.removedTotal} ` +
						`+${oneObserved.fullFormDifference.addedTotal}   ` +
						`OLD view: -${oneObserved.oldFormDifference.removedTotal} ` +
						`+${oneObserved.oldFormDifference.addedTotal}` +
						`${oneObserved.oldFormWasSilent ? '  (OLD FORM SILENT — the new gate sees what the old could not)' : ''}\n`
					: ''),
		);
	});
	process.stdout.write(
		`\n  RED OBSERVED ${redObservedTotal} / ${report.leverTotal}   MISMATCHES ${mismatchList.length}\n`,
	);

	process.exit(mismatchList.length === 0 && oldFormReconstructionExact ? 0 : 1);
});
