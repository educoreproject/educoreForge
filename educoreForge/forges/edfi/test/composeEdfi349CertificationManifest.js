#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     composeEdfi349CertificationManifest.js — compose the four-standard certification manifest
     for the Ed-Fi 349 remediation by REFERENCE, forging nothing.

DESCRIPTION
     TQ's ruling (2026-08-09): do not re-forge three unchanged standards to certify a change in
     one. A manifest is a named, ordered MEMBERSHIP of schema blocks and its refId IS the hash of
     that membership, so a new membership can reuse the EXACT blocks a previous build produced.

     This composes: ceds, pesc260805 and sif taken BY REFERENCE from the certified manifest's own
     membership, plus the POST-FIX edfi block, at the certified positions.

     WHY THIS IS A STRONGER REGRESSION TEST THAN RE-FORGING. Schema blocks are immutable and
     dedup on content address. The three unchanged standards are therefore the BYTE-IDENTICAL
     blocks that produced ceds 239,761 / sif 97,888 / pesc260805 173,216. Cross-standard
     regression is impossible BY CONSTRUCTION rather than merely unobserved, and exactly one
     member differs from the certified manifest — so anything that moves in the other three is a
     replay or engine defect, never an Ed-Fi one.

     REFUSES BY NAME rather than guessing: an absent source manifest, a member whose block is not
     in the store, a replacement subject that does not match the member it replaces, or a
     composed membership whose subjects/positions differ from the source.

     Writes nothing but the new manifest. The source manifest is never opened for mutation —
     manifestEditor DISABLES add on an opened manifest by design.

USAGE
     node composeEdfi349CertificationManifest.js \\
        --standardsDatabaseFilePath=<path> \\
        --sourceManifestRefId=<the certified four-standard manifest> \\
        --replacementBlockRefId=<the post-fix edfi standardBase block>

EXIT
     0 composed and saved (prints the new manifestRefId);  1 refusal.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const path = require('path');
const { pipeRunner, taskListPlus } = new require('qtools-asynchronous-pipe-plus')();

const TREE_ROOT = path.join(__dirname, '..', '..', '..');
const standardsDatabaseModule = require(path.join(TREE_ROOT, 'lib', 'standards-database', 'standards-database'));
const manifestEditorModule = require(path.join(TREE_ROOT, 'apps', 'graph-builder', 'apps', 'manifest-editor'));

const REPLACEMENT_SUBJECT_PREFIX = 'edfi@';

const commandLineParameters = process.global.commandLineParameters;
const takeParameter = (parameterName) => {
	const valueList = commandLineParameters.values[parameterName] || [];
	return valueList.length ? valueList[0] : '';
};

const standardsDatabaseFilePath = takeParameter('standardsDatabaseFilePath');
const sourceManifestRefId = takeParameter('sourceManifestRefId');
const replacementBlockRefId = takeParameter('replacementBlockRefId');

const refuseOut = (refusalMessage) => {
	console.error(`${moduleName} REFUSED: ${refusalMessage}`);
	process.exit(1);
};

if (!standardsDatabaseFilePath) {
	refuseOut('--standardsDatabaseFilePath is REQUIRED and has no default.');
}
if (!sourceManifestRefId) {
	refuseOut('--sourceManifestRefId is REQUIRED and has no default — it names the membership being reused.');
}
if (!replacementBlockRefId) {
	refuseOut('--replacementBlockRefId is REQUIRED and has no default — it names the post-fix edfi block.');
}

const standardsDatabaseFactory = standardsDatabaseModule();

const taskList = new taskListPlus();

// STAGE 1 — open the store
taskList.push((args, next) => {
	standardsDatabaseFactory.open({ databaseFilePath: standardsDatabaseFilePath }, (initError, openedStore) => {
		if (initError) {
			next(`opening the standardsDatabase: ${initError}`);
			return;
		}
		next("", { ...args, openedStore });
	});
});

// STAGE 2 — read the source membership. This is the contract being reused; it is never mutated.
taskList.push((args, next) => {
	args.openedStore.getManifest({ refId: sourceManifestRefId }, (getError, sourceManifest) => {
		if (getError) {
			next(`reading source manifest '${sourceManifestRefId}': ${getError}`);
			return;
		}
		if (!sourceManifest || !Array.isArray(sourceManifest.members) || !sourceManifest.members.length) {
			next(
				`source manifest '${sourceManifestRefId}' has no membership in this store. A membership ` +
					`that cannot be read cannot be reused, and composing from an assumed one is how a ` +
					`certification run silently certifies a different graph.`,
			);
			return;
		}
		next('', { ...args, sourceManifest });
	});
});

// STAGE 3 — resolve every member's block, substituting the replacement at the edfi position.
// Reads the REPLACEMENT block first so a bad refId refuses before anything else is done.
taskList.push((args, next) => {
	args.openedStore.getBlock({ refId: replacementBlockRefId }, (getError, replacementBlock) => {
		if (getError || !replacementBlock) {
			next(`replacement block '${replacementBlockRefId}' is not in this store: ${getError || 'no row'}`);
			return;
		}
		if (`${replacementBlock.subject}`.indexOf(REPLACEMENT_SUBJECT_PREFIX) !== 0) {
			next(
				`replacement block '${replacementBlockRefId}' has subject '${replacementBlock.subject}', ` +
					`which does not begin '${REPLACEMENT_SUBJECT_PREFIX}'. Refusing rather than substituting ` +
					`one standard's block for another's.`,
			);
			return;
		}

		const memberList = args.sourceManifest.members
			.slice()
			.sort((leftMember, rightMember) => leftMember.position - rightMember.position);

		const resolvedMemberList = [];
		const resolveNextMember = (memberIndex) => {
			if (memberIndex >= memberList.length) {
				next('', { ...args, resolvedMemberList, replacementBlock });
				return;
			}
			const oneMember = memberList[memberIndex];
			const isReplacementPosition = `${oneMember.subject}`.indexOf(REPLACEMENT_SUBJECT_PREFIX) === 0;
			if (isReplacementPosition) {
				if (`${oneMember.subject}` !== `${replacementBlock.subject}`) {
					next(
						`member at position ${oneMember.position} has subject '${oneMember.subject}' but the ` +
							`replacement block declares '${replacementBlock.subject}'. A substitution across ` +
							`differing subjects is refused, never reconciled.`,
					);
					return;
				}
				resolvedMemberList.push({
					subject: oneMember.subject,
					kind: oneMember.kind,
					version: oneMember.version,
					description: oneMember.description,
					schemaBlock: replacementBlock,
					sourceBlockRefId: oneMember.schemaBlockRefId,
					substituted: true,
				});
				setImmediate(() => resolveNextMember(memberIndex + 1));
				return;
			}
			args.openedStore.getBlock({ refId: oneMember.schemaBlockRefId }, (blockError, oneBlock) => {
				if (blockError || !oneBlock) {
					next(
						`member '${oneMember.subject}' names block '${oneMember.schemaBlockRefId}', which is ` +
							`not in this store: ${blockError || 'no row'}. Reuse BY REFERENCE requires the ` +
							`referent to exist; it is not reconstructible.`,
					);
					return;
				}
				resolvedMemberList.push({
					subject: oneMember.subject,
					kind: oneMember.kind,
					version: oneMember.version,
					description: oneMember.description,
					schemaBlock: oneBlock,
					sourceBlockRefId: oneMember.schemaBlockRefId,
					substituted: false,
				});
				setImmediate(() => resolveNextMember(memberIndex + 1));
			});
		};
		resolveNextMember(0);
	});
});

// STAGE 4 — refuse if the composition is not a one-member substitution
taskList.push((args, next) => {
	const substitutedList = args.resolvedMemberList.filter((oneMember) => oneMember.substituted);
	if (substitutedList.length !== 1) {
		next(
			`composition substitutes ${substitutedList.length} member(s); exactly ONE is required. The ` +
				`whole value of this route is that one member differs, so anything moving in the others ` +
				`is attributable.`,
		);
		return;
	}
	next('', args);
});

// STAGE 5 — compose and save
taskList.push((args, next) => {
	const manifest = manifestEditorModule({ standardsDatabase: args.openedStore }).init({
		name: 'fourWithNewEdfi',
		description:
			'Four-standard certification membership for the Ed-Fi 349 remediation: ceds, pesc260805 ' +
			'and sif reused BY REFERENCE from manifest ' + sourceManifestRefId + ' (byte-identical ' +
			'content-addressed blocks), with the POST-FIX edfi standardBase block substituted at its ' +
			'position. Exactly one member differs from the source.',
	});

	const addNextMember = (memberIndex) => {
		if (memberIndex >= args.resolvedMemberList.length) {
			manifest.save((saveError, savedRefId) => {
				if (saveError) {
					next(`saving the composed manifest: ${saveError}`);
					return;
				}
				next('', { ...args, savedRefId: savedRefId || manifest.refId() });
			});
			return;
		}
		const oneMember = args.resolvedMemberList[memberIndex];
		manifest.add(
			{
				subject: oneMember.subject,
				kind: oneMember.kind,
				version: oneMember.version,
				description: oneMember.description,
				schemaBlock: oneMember.schemaBlock,
			},
			(addError) => {
				if (addError) {
					next(`adding member '${oneMember.subject}': ${addError}`);
					return;
				}
				setImmediate(() => addNextMember(memberIndex + 1));
			},
		);
	};
	addNextMember(0);
});

pipeRunner(taskList.getList(), { }, (pipeError, args) => {
	if (pipeError) {
		refuseOut(pipeError);
		return;
	}
	console.log(
		JSON.stringify(
			{
				composedManifestRefId: args.savedRefId,
				sourceManifestRefId,
				memberList: args.resolvedMemberList.map((oneMember) => ({
					subject: oneMember.subject,
					blockRefId: oneMember.substituted
						? replacementBlockRefId
						: oneMember.sourceBlockRefId,
					reusedByReference: !oneMember.substituted,
				})),
			},
			null,
			1,
		),
	);
	process.exit(0);
});
