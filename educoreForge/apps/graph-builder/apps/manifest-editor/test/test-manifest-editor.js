#!/usr/bin/env node
'use strict';

// test-manifest-editor.js — gates for manifestEditor (store/manifest work order Phase 3).
//
// Everything runs against a throwaway standards database under the OS temp directory. No project
// database is opened, no Docker is spawned, no vectorizer is called: manifestEditor composes and
// persists, and persistence is the only thing it touches.
//
// THE ASSERTION THIS SUITE EXISTS FOR: a manifest is addressed by its MEMBERSHIP and by nothing
// else. Names and descriptions are for humans finding things later, and folding either of them
// into the address would make fixing a typo mint a different manifest. That is proven here by
// composing the same membership twice under different names and different member descriptions and
// demanding the SAME refId back.
//
// Run: node apps/graph-builder/apps/manifest-editor/test/test-manifest-editor.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gates for manifestEditor (compose, write through, address, reopen)

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves init refuses a missing store / blank name / blank description; that add refuses a
     blank subjectRefId, a kind outside the LOCKED taxonomy, a blank description, a schema block
     with no text, a schema block whose id is not sha256 of its text, and a repeated subjectRefId;
     that add writes the schema block THROUGH to the store immediately rather than accumulating
     text; that members() hands back a COPY; that refId() is manifestKeyForMembership and that it
     and save() both refuse an empty manifest; that schemaBlocks() resolves in order and refuses
     an absent block by name;
     that save() dedups on identical membership; that DESCRIPTIONS ARE OUTSIDE THE ADDRESS; and
     that a manifest reopened from the store has a DISABLED add. Throwaway database under the OS
     temp directory.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../../test/testLib/harness')(moduleName);

// The recipe TEXT, not just its name: provenance has to answer "built from exactly which recipe",
// and a recipe called 'gateRecipe' is a different document on two different days.
const GATE_RECIPE_TEXT = '{"recipeName":"gateRecipe","standards":[{"token":"lif"}]}\n';

const fs = require('fs');
const os = require('os');
const path = require('path');

const manifestEditor = require('../manifestEditor')();
const standardsDatabase = require('../../../../../lib/standards-database/standards-database')();
const contentAddress = require('../../../../../lib/content-address/content-address')();

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edfManifestGate-'));
const databaseFilePath = path.join(scratchDir, `gate_${process.pid}.sqlite3`);
const cleanup = () => fs.rmSync(scratchDir, { recursive: true, force: true });

// This suite is one long chain of callbacks, and a chain that dies in the middle empties the event
// loop and exits 0 — a silent green that proves nothing. The guard makes an unfinished run FAIL,
// which is the only reason it is safe to write the suite in this shape at all.
let reportWasReached = false;
process.on('exit', (code) => {
	if (!reportWasReached) {
		cleanup(); // a run that died still owns its scratch directory
		if (code === 0) {
			process.stdout.write(
				`${moduleName}: FAILED — the suite exited before reaching its report. The async ` +
					`chain died silently.\n`,
			);
			process.exitCode = 1;
		}
	}
});

const finish = () => {
	reportWasReached = true;
	cleanup();
	harness.report();
};

// The shape replayManager.harvest hands back: block TEXT plus the id minted from it at the moment
// the block came into existence. Built here with the same shared rule the store uses, because a
// fixture that invented its own id would be testing nothing.
const makeSchemaBlock = (blockText) => ({
	blockText,
	blockId: contentAddress.blockIdForText(blockText),
});

const LIF_BLOCK = makeSchemaBlock(
	`{"kind":"header","blockType":"standardBase","standardKey":"LIF","version":"1.0"}
{"kind":"node","stableId":"urn:lif:learnerRecord","labels":["StandardBase"],"note":"it's got an apostrophe"}
`,
);
const CEDS_BLOCK = makeSchemaBlock(
	`{"kind":"header","blockType":"standardBase","standardKey":"CEDS","version":"11"}
{"kind":"node","stableId":"urn:ceds:000001","labels":["StandardBase"]}
`,
);
const HUB_BLOCK = makeSchemaBlock(
	`{"kind":"header","blockType":"hub","standardKey":"CEDS","version":"11"}
{"kind":"node","stableId":"urn:ceds:hubRef:000001","labels":["HubReference"]}
`,
);

// the message-carrying capture used for every sync refusal: init() and refId() are synchronous by
// design (the §4.4 pseudocode composes with them inline), so their refusal is a throw.
const refusalFrom = (fn) => {
	try {
		fn();
	} catch (error) {
		return error.message;
	}
	return '';
};

// =====================================================================
harness.section('INIT — refuses what it cannot compose with');
// =====================================================================

harness.match(
	'a manifest with no store is REFUSED',
	refusalFrom(() => manifestEditor.init({ name: 'noStore', description: 'has no store' })),
	/store is REQUIRED/,
);
harness.match(
	'  naming the manifest that asked',
	refusalFrom(() => manifestEditor.init({ name: 'noStore', description: 'has no store' })),
	/noStore/,
);

standardsDatabase.open({ databaseFilePath }, (openErr, store) => {
	if (openErr) {
		harness.ok('a throwaway standards database opened', false, openErr);
		finish();
		return;
	}
	harness.ok('a throwaway standards database opened', !!store);

	harness.match(
		'a blank name is REFUSED',
		refusalFrom(() => manifestEditor.init({ name: '   ', description: 'described', store })),
		/name is REQUIRED/,
	);
	harness.match(
		'a blank description is REFUSED',
		refusalFrom(() => manifestEditor.init({ name: 'unDescribed', description: '', store })),
		/description is REQUIRED/,
	);
	harness.match(
		'  naming the manifest that asked',
		refusalFrom(() => manifestEditor.init({ name: 'unDescribed', description: '', store })),
		/unDescribed/,
	);

	const manifest = manifestEditor.init({
		name: 'gateManifest',
		description: 'the manifest this suite composes',
		recipe: { recipeName: 'gateRecipe' },
		recipeText: GATE_RECIPE_TEXT,
		store,
	});
	harness.ok('a well-formed manifest is composed', !!manifest);
	harness.equal(
		'the recipe is held as a provenance REFERENCE, by name',
		manifest.recipeName(),
		'gateRecipe',
	);
	harness.equal('a new manifest starts empty', manifest.members().length, 0);

	harness.match(
		'RED PROOF: refId() on an EMPTY manifest is REFUSED',
		refusalFrom(() => manifest.refId()),
		/empty manifest/,
	);
	harness.match(
		'  naming the manifest',
		refusalFrom(() => manifest.refId()),
		/gateManifest/,
	);

	// save() must refuse an empty manifest through the same door refId() refuses it, or the two
	// verbs disagree about whether an empty manifest has an identity: one would write the shared
	// empty-membership address that the other will not hand out.
	manifest.save((emptySaveErr) => {
		harness.match(
			'save() on an EMPTY manifest is REFUSED too',
			emptySaveErr,
			/empty manifest/,
		);
		harness.match('  naming the manifest', emptySaveErr, /gateManifest/);

		addRefusalGates(store, manifest);
	});
});

// A function DECLARATION, not a const arrow: every stage below is called from inside a callback
// nest above it, and a const would sit in the temporal dead zone at that moment. The resulting
// ReferenceError is swallowed by sqlite-instance's SQL error handling and RETRIED, so a one-line
// hoisting mistake presents as dozens of assertion failures and a wall of bad-statement output.
// (Same trap recorded in test-standards-database.)
function addRefusalGates(store, manifest) {
	harness.section('ADD — every refusal, firing, naming what offended');

	manifest.add(
		{ subjectRefId: '', kind: 'standardBase', description: 'd', schemaBlock: LIF_BLOCK },
		(blankSubjectErr) => {
			harness.match(
				'a blank subjectRefId is REFUSED',
				blankSubjectErr,
				/subjectRefId is REQUIRED/,
			);

			manifest.add(
				{
					subjectRefId: 'lif@1.0',
					kind: 'somethingInvented',
					description: 'd',
					schemaBlock: LIF_BLOCK,
				},
				(kindErr) => {
					harness.match(
						'a kind outside the LOCKED taxonomy is REFUSED',
						kindErr,
						/is not one of standardBase \| hub \| relationship/,
					);
					harness.match('  naming the offending kind', kindErr, /somethingInvented/);

					manifest.add(
						{
							subjectRefId: 'lif@1.0',
							kind: 'standardBase',
							description: '   ',
							schemaBlock: LIF_BLOCK,
						},
						(descriptionErr) => {
							harness.match(
								'a blank member description is REFUSED',
								descriptionErr,
								/description is REQUIRED/,
							);
							harness.match(
								'  naming the member it was missing from',
								descriptionErr,
								/lif@1\.0/,
							);

							manifest.add(
								{
									subjectRefId: 'lif@1.0',
									kind: 'standardBase',
									description: 'd',
									schemaBlock: { blockId: 'whatever', blockText: '' },
								},
								(noTextErr) => {
									harness.match(
										'a schema block with no text is REFUSED',
										noTextErr,
										/carries no text/,
									);
									harness.match('  naming the member', noTextErr, /lif@1\.0/);

									manifest.add(
										{
											subjectRefId: 'lif@1.0',
											kind: 'standardBase',
											description: 'd',
											schemaBlock: {
												blockId: 'deadbeef',
												blockText: LIF_BLOCK.blockText,
											},
										},
										(addressErr) => {
											harness.match(
												'RED PROOF: a schema block whose id is not sha256 of its text is REFUSED',
												addressErr,
												/content address/,
											);
											harness.match(
												'  naming the claimed id',
												addressErr,
												/deadbeef/,
											);
											harness.match(
												'  and what the text actually hashes to',
												addressErr,
												new RegExp(LIF_BLOCK.blockId),
											);

											harness.equal(
												'not one refusal added a member',
												manifest.members().length,
												0,
											);

											writeThroughGates(store, manifest);
										},
									);
								},
							);
						},
					);
				},
			);
		},
	);
}

function writeThroughGates(store, manifest) {
	harness.section('ADD — the schema block is written THROUGH to the store IMMEDIATELY');

	manifest.add(
		{
			subjectRefId: 'lif@1.0',
			kind: 'standardBase',
			description: 'LIF 1.0 — the standard\'s own nodes and internal edges',
			schemaBlock: LIF_BLOCK,
		},
		(err, report) => {
			if (err) {
				harness.ok('a member is added', false, err);
				finish();
				return;
			}
			harness.ok('a member is added', !!report);
			harness.equal('  and the member count is reported', report.memberCount, 1);
			harness.equal(
				'  under the schema block address the producer minted',
				report.schemaBlockRefId,
				LIF_BLOCK.blockId,
			);

			// THE POINT: the text is in the store NOW, before save() has been called. Nothing is
			// accumulating in RAM waiting for a save that a failed build may never reach.
			store.getBlock({ refId: LIF_BLOCK.blockId }, (readErr, row) => {
				harness.ok(
					'the schema block is IN THE STORE before save() is ever called',
					!readErr && !!row,
					readErr,
				);
				harness.equal('  with its text intact, apostrophe and all', row.text, LIF_BLOCK.blockText);
				harness.equal('  under the LOCKED taxonomy kind it was added as', row.kind, 'standardBase');
				harness.equal('  carrying its subject', row.subjectRefId, 'lif@1.0');

				manifest.add(
					{
						subjectRefId: 'lif@1.0',
						kind: 'standardBase',
						description: 'a second try at the same subject',
						schemaBlock: LIF_BLOCK,
					},
					(dupErr) => {
						harness.match(
							'a subjectRefId already present is REFUSED',
							dupErr,
							/already present/,
						);
						harness.match('  naming the repeated subject', dupErr, /lif@1\.0/);
						harness.equal(
							'  and membership is unchanged',
							manifest.members().length,
							1,
						);

						manifest.add(
							{
								subjectRefId: 'ceds@11',
								kind: 'standardBase',
								description: 'CEDS 11 — the standard base',
								schemaBlock: CEDS_BLOCK,
							},
							(e2) => {
								if (e2) {
									harness.ok('a second member is added', false, e2);
									finish();
									return;
								}
								manifest.add(
									{
										subjectRefId: 'ceds@11:hub',
										kind: 'hub',
										description: 'CEDS 11 — the hub reference subgraph',
										schemaBlock: HUB_BLOCK,
									},
									(e3) => {
										if (e3) {
											harness.ok('a hub member is added', false, e3);
											finish();
											return;
										}
										harness.equal(
											'three members compose',
											manifest.members().length,
											3,
										);
										membershipGates(store, manifest);
									},
								);
							},
						);
					},
				);
			});
		},
	);
}

function membershipGates(store, manifest) {
	harness.section('MEMBERS — a COPY, positioned by the order they were added');

	const members = manifest.members();
	harness.equal(
		'the member record carries the settled vocabulary',
		Object.keys(members[0]).sort().join(','),
		'description,kind,position,schemaBlockRefId,subjectRefId',
	);
	harness.equal('positions are the insertion order', members.map((one) => one.position).join(','), '0,1,2');
	harness.equal(
		'subjects are in insertion order',
		members.map((one) => one.subjectRefId).join(','),
		'lif@1.0,ceds@11,ceds@11:hub',
	);

	// A caller that can mutate membership can change the manifest's identity without anyone
	// noticing, because identity IS membership. So members() hands back a copy of the records,
	// not the records.
	const addressBefore = manifest.refId();
	members.push({ subjectRefId: 'smuggled@1', kind: 'hub', schemaBlockRefId: 'x', position: 99 });
	members[0].schemaBlockRefId = 'tampered';
	members[0].position = 42;

	harness.equal('mutating the returned array does not add a member', manifest.members().length, 3);
	harness.equal(
		'mutating a returned record does not change the membership',
		manifest.members()[0].schemaBlockRefId,
		LIF_BLOCK.blockId,
	);
	harness.equal(
		'  and therefore does not change the manifest address',
		manifest.refId(),
		addressBefore,
	);

	harness.section('REFID — manifestKeyForMembership, the ONE addressing rule');

	harness.match('the address is a sha256', manifest.refId(), /^[0-9a-f]{64}$/);
	harness.equal(
		'it is the SHARED rule applied to this membership, not a second rule of its own',
		manifest.refId(),
		contentAddress.manifestKeyForMembership(
			manifest.members().map((one) => ({
				blockId: one.schemaBlockRefId,
				position: one.position,
			})),
		),
	);

	schemaBlockGates(store, manifest);
}

function schemaBlockGates(store, manifest) {
	harness.section('SCHEMABLOCKS — resolved through the store, in order');

	manifest.schemaBlocks((err, blocks) => {
		if (err) {
			harness.ok('every member resolves to its schema block', false, err);
			finish();
			return;
		}
		harness.equal('every member resolves to its schema block', blocks.length, 3);
		harness.equal(
			'  in membership order',
			blocks.map((one) => one.refId).join(','),
			[LIF_BLOCK.blockId, CEDS_BLOCK.blockId, HUB_BLOCK.blockId].join(','),
		);
		harness.equal('  carrying the block text', blocks[0].text, LIF_BLOCK.blockText);

		saveGates(store, manifest);
	});
}

function saveGates(store, manifest) {
	harness.section('SAVE — the stored address IS the composed address, and it dedups');

	const composedAddress = manifest.refId();

	manifest.save((err, saveReport) => {
		if (err) {
			harness.ok('the manifest saves', false, err);
			finish();
			return;
		}
		harness.ok('the manifest saves', !!saveReport);
		harness.equal(
			'the stored manifestRefId is exactly what refId() composed (one addressing rule, not two)',
			saveReport.manifestRefId,
			composedAddress,
		);
		harness.equal('  with its member count', saveReport.memberCount, 3);

		manifest.save((e2, again) => {
			harness.equal('saving again is the SAME manifest', again.manifestRefId, composedAddress);
			harness.equal('  and it deduped rather than making a second one', again.alreadyPresent, true);

			store.getManifest({ refId: composedAddress }, (readErr, stored) => {
				harness.ok('the manifest reads back from the store', !readErr && !!stored, readErr);
				harness.equal('  with its membership', stored.members.length, 3);
				harness.equal(
					'  carrying the human description of a member',
					stored.members[0].description,
					'LIF 1.0 — the standard\'s own nodes and internal edges',
				);
				harness.equal('  and the manifest name', stored.name, 'gateManifest');

				descriptionGates(store, composedAddress);
			});
		});
	});
}

function descriptionGates(store, composedAddress) {
	harness.section('DESCRIPTIONS ARE OUTSIDE THE ADDRESS — the whole point, proven');
	// manifestKeyForMembership hashes schemaBlockRefId + position, nothing else. Fixing a typo in
	// a description must never change a manifest's identity, or nobody will ever dare fix one.

	const twin = manifestEditor.init({
		name: 'a completely different name',
		description: 'entirely different prose about the same thing',
		recipe: { recipeName: 'someOtherRecipe' },
		store,
	});

	twin.add(
		{
			subjectRefId: 'lif@1.0',
			kind: 'standardBase',
			description: 'described in wholly different words',
			schemaBlock: LIF_BLOCK,
		},
		(e1) => {
			if (e1) {
				harness.ok('the twin composes', false, e1);
				finish();
				return;
			}
			twin.add(
				{
					subjectRefId: 'ceds@11',
					kind: 'standardBase',
					description: 'and so is this one',
					schemaBlock: CEDS_BLOCK,
				},
				(e2) => {
					if (e2) {
						harness.ok('the twin composes', false, e2);
						finish();
						return;
					}
					twin.add(
						{
							subjectRefId: 'ceds@11:hub',
							kind: 'hub',
							description: 'and this one too',
							schemaBlock: HUB_BLOCK,
						},
						(e3) => {
							if (e3) {
								harness.ok('the twin composes', false, e3);
								finish();
								return;
							}
							harness.equal(
								'identical MEMBERSHIP is the SAME manifest, whatever the names and descriptions say',
								twin.refId(),
								composedAddress,
							);

							twin.save((saveErr, twinReport) => {
								harness.equal(
									'  and saving it dedups onto the manifest already stored',
									twinReport.manifestRefId,
									composedAddress,
								);
								harness.equal(
									'  rather than minting a second one',
									twinReport.alreadyPresent,
									true,
								);

								openGates(store, composedAddress);
							});
						},
					);
				},
			);
		},
	);
}

function openGates(store, composedAddress) {
	harness.section('OPEN — a stored manifest is immutable, and says so');

	manifestEditor.open({ manifestRefId: composedAddress }, (noStoreErr) => {
		harness.match('opening with no store is REFUSED', noStoreErr, /store is REQUIRED/);

		manifestEditor.open({ store, manifestRefId: '' }, (noRefErr) => {
			harness.match('opening with no manifestRefId is REFUSED', noRefErr, /manifestRefId is REQUIRED/);

			manifestEditor.open({ store, manifestRefId: 'noSuchManifest' }, (missingErr) => {
				harness.match(
					'opening a manifest that is not there is REFUSED',
					missingErr,
					/no manifest/i,
				);
				harness.match('  naming the address asked for', missingErr, /noSuchManifest/);

				manifestEditor.open({ store, manifestRefId: composedAddress }, (openErr, reopened) => {
					if (openErr) {
						harness.ok('a stored manifest reopens', false, openErr);
						finish();
						return;
					}
					harness.ok('a stored manifest reopens', !!reopened);
					harness.equal('  with its membership', reopened.members().length, 3);
					harness.equal(
						'  in the order it was composed',
						reopened.members().map((one) => one.subjectRefId).join(','),
						'lif@1.0,ceds@11,ceds@11:hub',
					);
					harness.equal(
						'  and it re-addresses to exactly what it was stored under',
						reopened.refId(),
						composedAddress,
					);

					// PROVENANCE SURVIVES THE REOPEN (TQ, 2026-07-22: "Yes, I want the
					// provenance."). A manifest that cannot say what composed it is a golden
					// nobody can account for six months later. The recipe NAME says which recipe;
					// the recipe refId says which VERSION of it, because a recipe called 'cedsLif'
					// is a different document in March than in July and two goldens built from
					// "the same recipe" can differ entirely.
					harness.equal(
						'PROVENANCE: the recipe NAME survived being stored and reopened',
						reopened.recipeName(),
						'gateRecipe',
					);
					harness.match(
						'  and the recipe CONTENT ADDRESS survived too',
						reopened.recipeRefId(),
						/^[0-9a-f]{64}$/,
					);
					harness.equal(
						'  matching what the composing manifest computed',
						reopened.recipeRefId(),
						contentAddress.blockIdForText(GATE_RECIPE_TEXT),
					);

					// Adding to a manifest already addressed by its membership would make its refId
					// a lie: the stored address describes a membership that no longer holds.
					reopened.add(
						{
							subjectRefId: 'sneak@1',
							kind: 'standardBase',
							description: 'smuggled in after the fact',
							schemaBlock: CEDS_BLOCK,
						},
						(addErr) => {
							harness.match(
								'RED PROOF: add on a REOPENED manifest is REFUSED',
								addErr,
								/immutable/,
							);
							harness.match('  naming the manifest', addErr, new RegExp(composedAddress));
							harness.match('  naming what it tried to add', addErr, /sneak@1/);
							harness.equal(
								'  and membership is unchanged',
								reopened.members().length,
								3,
							);

							absentBlockGates(store, composedAddress);
						},
					);
				});
			});
		});
	});
}

function absentBlockGates(store, composedAddress) {
	harness.section('SCHEMABLOCKS — an absent block is REFUSED, not skipped');
	// A manifest that quietly resolves two of its three blocks materializes a partial graph that
	// looks like a whole one. That is the failure this refusal exists to make impossible.
	//
	// The gap is staged with a stand-in that DELEGATES everything to the real store except one
	// getBlock, rather than by deleting the row: sqlite-instance enforces foreign keys, so the
	// store physically refuses to lose a block a manifest still references (proven — the DELETE
	// comes back 'FOREIGN KEY constraint failed'). That refusal is a property worth having, and it
	// means the only honest way to observe manifestEditor's own behaviour is to have the store
	// answer null — which is exactly what the real store does for a block that is not there
	// (proven in test-standards-database). Everything else here is real: real open, real
	// membership, real ordering.
	const amnesiacStore = {
		...store,
		getBlock: ({ refId }, callback) => {
			if (refId === CEDS_BLOCK.blockId) {
				callback('', null);
				return;
			}
			store.getBlock({ refId }, callback);
		},
	};

	manifestEditor.open({ store: amnesiacStore, manifestRefId: composedAddress }, (openErr, gappy) => {
		if (openErr) {
			harness.ok('the manifest reopens against the stand-in store', false, openErr);
			finish();
			return;
		}
		gappy.schemaBlocks((err, blocks) => {
			harness.match(
				'RED PROOF: a member whose schema block is gone is REFUSED',
				err,
				/is not in the store/,
			);
			harness.match('  naming the manifest', err, new RegExp(composedAddress));
			harness.match('  naming the member subject', err, /ceds@11/);
			harness.match('  naming the missing block', err, new RegExp(CEDS_BLOCK.blockId));
			harness.ok('  and returns NOTHING', blocks === undefined);

			finish();
		});
	});
}
