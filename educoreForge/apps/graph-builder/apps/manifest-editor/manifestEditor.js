'use strict';

/** @implements {ManifestEditorComponent} — formal contract declared in
 *  apps/graph-builder/interfaces.js; enforced by test-interfaces. */

// manifestEditor — what a set of schema blocks BELONGS TO, and the only thing that puts one away.
//
// A manifest is a named, described, ordered membership of schema blocks. Its refId IS the hash of
// that membership (contentAddress.manifestKeyForMembership), so composing the same membership twice
// yields the same manifest rather than a second one, and no manifest can claim an identity its
// members do not support.
//
// ADD WRITES THE SCHEMA BLOCK THROUGH TO THE STORE IMMEDIATELY. It does not accumulate text. Two
// things follow and both are the reason: eighteen standards' block text never sits in RAM at once,
// and a build that dies halfway leaves a WARM CACHE rather than a mess — blocks are immutable and
// dedup on their content address, so the next run re-saves the same bytes to the same address for
// free. The save() that never happened is then the only thing lost.
//
// DESCRIPTIONS ARE REQUIRED AND ARE DELIBERATELY OUTSIDE THE CONTENT ADDRESS. Every member must
// carry one, and so must the manifest, because a membership of forty sha256 addresses is unreadable
// to the human who has to decide whether it is the right one. But manifestKeyForMembership hashes
// schemaBlockRefId + position and NOTHING ELSE. Fixing a typo in a description must never change a
// manifest's identity — fold the prose into the address and nobody will ever dare correct it. This
// is stated here, in the header, precisely because it is the kind of thing a later reader helpfully
// "fixes" by including the descriptions in the hash.
//
// AN OPENED MANIFEST IS IMMUTABLE. open() loads a stored membership and DISABLES add: a manifest
// already addressed by its membership cannot grow, because the address it is stored under would
// become a lie about what it contains.
//
// VOCABULARY (TQ, 2026-07-22): `refId` is a thing's own id; `<subject>RefId` is a reference to
// another thing. "key" is banned as too general. Member record:
// { subject, kind, schemaBlockRefId, position, description }.
//
// ASYNC STYLE: callback(errString, result) — err is '' on success. The verbs that reach the standardsDatabase
// (add, schemaBlocks, save, open) are callback-shaped. init(), members() and refId() are
// SYNCHRONOUS by design — the §4.4 build sequence composes with them inline — so their refusals are
// throws, the same choice content-address.vectorIdForInput makes for a violated precondition. A
// synchronous precondition violation is a caller bug, not a control-flow branch.

const path = require('path');

const TREE_LIB = path.join(__dirname, '..', '..', '..', '..', 'lib');
const contentAddress = require(path.join(TREE_LIB, 'content-address', 'content-address'))();

// The block taxonomy is LOCKED (targetArchitectureDesign §2). Importing it rather than restating it
// is the point: two copies of a locked taxonomy is how a kind comes to be acceptable here and
// refused one layer down.
//
// It is read from lib/vocabulary, the registry that exists for exactly this purpose. It used to be
// read from standards-database, which forced a LAZY require: standards-database pulls in
// sqlite-instance, which destructures process.global at REQUIRE time, so importing the taxonomy at
// the top made this module impossible to require before the app bootstrapped. vocabulary is a pure
// data module with no such appetite, so the import is unconditional and that debt is retired.
const KINDS = require(path.join(TREE_LIB, 'vocabulary', 'vocabulary')).SCHEMA_BLOCK_KINDS;

// replayManager.harvest — the only place a schema block is born — hands back { blockText, blockId }.
// The settled vocabulary is { text, refId }, and replayManager is out of scope for this phase, so
// both names are read here. This is a NAME bridge, not a second addressing rule: the address is
// always contentAddress.blockIdForText, recomputed below and compared with what the producer
// claimed. When replayManager adopts the vocabulary, the second half of each expression goes.
const textOfSchemaBlock = (schemaBlock) =>
	!schemaBlock ? '' : schemaBlock.text != null ? schemaBlock.text : schemaBlock.blockText;
const refIdOfSchemaBlock = (schemaBlock) =>
	!schemaBlock ? '' : schemaBlock.refId || schemaBlock.blockId || '';

const isBlank = (value) => typeof value !== 'string' || value.trim() === '';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	({ standardsDatabase } = {}) => {
	// standardsDatabase is a CONSTRUCTION dependency, handed once (manifestEditor({ standardsDatabase }))
	// rather than on every init/open. It is an invariant across a manifestEditor's whole life — the
	// same database backs every manifest it composes or opens — so passing it per-call made the
	// signatures lie about what varies. It is validated at first use (init throws, open calls back an
	// error) so the component can still be constructed for shape inspection without a live database.
	// -----
	// init — compose a NEW manifest. Synchronous; refuses by throwing (see ASYNC STYLE above).
	//
	// The recipe is held as a provenance REFERENCE — recorded so a stored block can say what built
	// it, and never consulted for a decision. manifestEditor is handed resolved subjects and schema
	// blocks; a component that read the recipe to decide something would be a second resolver, free
	// to disagree with the first.
	const init = ({ name, description, recipe, recipeText, recipeFileName }) => {
		if (!standardsDatabase || typeof standardsDatabase.saveBlock !== 'function') {
			throw new Error(
				`manifestEditor.init '${name}': a standardsDatabase is REQUIRED at construction ` +
					`(manifestEditor({ standardsDatabase })) and has no default. A manifest writes its ` +
					`schema blocks through on every add, so a manifest with nowhere to write is a ` +
					`manifest that silently loses them.`,
			);
		}
		if (isBlank(name)) {
			throw new Error(
				`manifestEditor.init: a name is REQUIRED and must not be blank. A membership of ` +
					`sha256 addresses is unreadable; the name is how a human finds this manifest again.`,
			);
		}
		if (isBlank(description)) {
			throw new Error(
				`manifestEditor.init '${name}': a description is REQUIRED and must not be blank. It ` +
					`is what tells the next person whether this is the manifest they want.`,
			);
		}

		return makeManifest({
			name,
			description,
			recipeName: (recipe && recipe.recipeName) || '',
			// The recipe's own content address, when the caller has the file text. A recipe NAME
			// says which recipe; a recipe named 'cedsLif' is a different document in March than in
			// July, and two goldens built from "the same recipe" can differ entirely. The hash is
			// what makes "built from exactly this" answerable. Optional, because a caller that does
			// not have the text should record nothing rather than invent precision.
			recipeHash: recipeText ? contentAddress.blockIdForText(recipeText) : '',
			// which recipe FILE composed this manifest — a plain filename, not a key. Optional, same
			// discipline as the hash: absent when the caller does not have it.
			recipeFileName: recipeFileName || '',
			standardsDatabase,
			members: [],
			storedRefId: '',
		});
	};

	// -----
	// open — load a STORED manifest. Its add is DISABLED: the manifest is already addressed by its
	// membership, and adding to it would make that address a lie about what it contains.
	const open = ({ manifestRefId }, callback) => {
		if (!standardsDatabase || typeof standardsDatabase.getManifest !== 'function') {
			callback(
				`manifestEditor.open '${manifestRefId}': a standardsDatabase is REQUIRED at ` +
					`construction (manifestEditor({ standardsDatabase })) and has no default.`,
			);
			return;
		}
		if (isBlank(manifestRefId)) {
			callback('manifestEditor.open: a manifestRefId is REQUIRED — there is nothing to open.');
			return;
		}

		standardsDatabase.getManifest({ refId: manifestRefId }, (err, storedManifest) => {
			if (err) {
				callback(`manifestEditor.open '${manifestRefId}': ${err}`);
				return;
			}
			if (!storedManifest) {
				callback(
					`manifestEditor.open: there is no manifest '${manifestRefId}' in the standardsDatabase at ` +
						`'${standardsDatabase.databaseFilePath}'. Refusing to hand back an empty manifest that ` +
						`would be indistinguishable from an emptied one.`,
				);
				return;
			}

			// getManifest joins each membership row to its block's kind and subject, so the stored
			// rows already carry the whole member record. Copied into our own shape so nothing the
			// standardsDatabase happens to select rides along unnoticed.
			const members = (storedManifest.members || []).map((oneRow) => ({
				subject: oneRow.subject,
				kind: oneRow.kind,
				schemaBlockRefId: oneRow.schemaBlockRefId,
				position: oneRow.position,
				description: oneRow.description,
			}));

			callback(
				'',
				makeManifest({
					name: storedManifest.name,
					description: storedManifest.description,
					// The provenance SURVIVES the reopen, which is the entire reason it is stored:
					// a manifest that cannot say what composed it is a golden nobody can account
					// for six months later. (TQ, 2026-07-22: "Yes, I want the provenance.")
					recipeName: storedManifest.recipeName || '',
					recipeHash: storedManifest.recipeHash || '',
					recipeFileName: storedManifest.recipeFileName || '',
					standardsDatabase,
					members,
					storedRefId: manifestRefId,
				}),
			);
		});
	};

	return { init, open };
};

// -----
// makeManifest — the manifest handle. ONE factory for both doors, because a manifest opened from
// the standardsDatabase and a manifest being composed must address themselves by the identical rule; two
// factories is how they would come to disagree. The only difference between them is storedRefId,
// which is what disables add.
//
// A function DECLARATION, not a const arrow: it is called from init() and from inside open()'s
// callback nest above, where a const would sit in the temporal dead zone. The resulting
// ReferenceError is swallowed by sqlite-instance's SQL error handling and RETRIED, so a one-line
// hoisting mistake presents as dozens of unrelated assertion failures.
function makeManifest({ name, description, recipeName, recipeHash, recipeFileName, standardsDatabase, members, storedRefId }) {
	// how this manifest names itself in a refusal: a stored one by its address, a composed one by
	// its name, because a composed manifest's address changes with every add.
	const selfName = () => (storedRefId ? `manifest ${storedRefId}` : `manifest '${name}'`);

	// -----
	// add — validate, write the schema block THROUGH to the standardsDatabase, then record the membership.
	const add = ({ subject, kind, version, description: memberDescription, schemaBlock }, callback) => {
		if (storedRefId) {
			callback(
				`manifestEditor.add '${subject}' to ${selfName()}: REFUSED — a manifest opened ` +
					`from the standardsDatabase is immutable. Its refId IS its membership, so adding to it would ` +
					`make the address it is stored under a lie about what it contains. Compose a new ` +
					`manifest instead.`,
			);
			return;
		}

		const blockText = textOfSchemaBlock(schemaBlock);
		const claimedRefId = refIdOfSchemaBlock(schemaBlock);

		if (isBlank(subject)) {
			callback(
				`manifestEditor.add to ${selfName()}: a subject is REQUIRED — it is what the ` +
					`schema block is ABOUT (standardName@version, or pair@versionKey for a ` +
					`relationship), and a member nobody can name is a member nobody can find.`,
			);
			return;
		}
		if (!KINDS.includes(kind)) {
			callback(
				`manifestEditor.add to ${selfName()}: kind '${kind}' for subject '${subject}' ` +
					`is not one of ${KINDS.join(' | ')}. The block taxonomy is LOCKED ` +
					`(targetArchitectureDesign §2); an unknown kind is a caller bug, not an ` +
					`extension point.`,
			);
			return;
		}
		if (isBlank(memberDescription)) {
			callback(
				`manifestEditor.add '${subject}' to ${selfName()}: a description is REQUIRED ` +
					`and must not be blank. It sits outside the content address precisely so it can ` +
					`be written for humans and corrected freely — which is worth nothing if it is ` +
					`left empty.`,
			);
			return;
		}
		if (typeof blockText !== 'string' || blockText.length === 0) {
			callback(
				`manifestEditor.add '${subject}' to ${selfName()}: the schemaBlock carries no ` +
					`text. A member pointing at nothing would materialize a graph that looks whole ` +
					`and is not.`,
			);
			return;
		}

		// The producer minted the address when the block came into existence. Recomputing it here
		// and demanding the two agree is what stops a block entering the standardsDatabase under an address
		// that does not describe it — the standardsDatabase's verify-on-read would then refuse it forever after.
		const actualRefId = contentAddress.blockIdForText(blockText);
		if (claimedRefId !== actualRefId) {
			callback(
				`manifestEditor.add '${subject}' to ${selfName()}: the schemaBlock claims ` +
					`content address '${claimedRefId}' but its text hashes to ${actualRefId}. ` +
					`Refusing to standardsDatabase a block under an address that does not describe it.`,
			);
			return;
		}

		const alreadyThere = members.filter((oneMember) => oneMember.subject === subject)[0];
		if (alreadyThere) {
			callback(
				`manifestEditor.add to ${selfName()}: subject '${subject}' is already ` +
					`present at position ${alreadyThere.position}. One subject contributes one schema ` +
					`block of one kind; a second is a build repeating itself, which is a defect worth ` +
					`hearing about rather than a membership worth having.`,
			);
			return;
		}

		// version IS passed now: build.js resolves the EXPLICIT version from the forge's snapshot-
		// provenance triple. The subject carries a SLUGGED version for a clean key; this column carries
		// the PRETTY resolved version for querying — the same fact in key-safe and readable forms, not
		// two answers. (It was omitted on the theory "subject IS the version", but the subject then held
		// the floating 'current', so the column stayed null and the real version was unqueryable.)
		standardsDatabase.saveBlock(
			{
				text: blockText,
				kind,
				subject,
				version,
				producedBy: recipeName
					? `manifestEditor '${name}' (recipe ${recipeName})`
					: `manifestEditor '${name}'`,
			},
			(saveErr, saveReport) => {
				if (saveErr) {
					callback(`manifestEditor.add '${subject}' to ${selfName()}: ${saveErr}`);
					return;
				}
				members.push({
					subject,
					kind,
					schemaBlockRefId: saveReport.refId,
					position: members.length,
					description: memberDescription,
				});
				callback('', {
					memberCount: members.length,
					schemaBlockRefId: saveReport.refId,
					alreadyPresent: saveReport.alreadyPresent,
				});
			},
		);
	};

	// -----
	// members — a COPY, records and all. Identity IS membership, so a caller holding the real
	// records could change what this manifest is without anyone noticing.
	const membersCopy = () => members.map((oneMember) => ({ ...oneMember }));

	// -----
	// refId — the ONE addressing rule, shared with the standardsDatabase so a composed address and a stored
	// address cannot differ. The standardsDatabase's members speak schemaBlockRefId and the shared rule speaks
	// blockId; the mapping happens at the boundary, here and in saveManifest, rather than by
	// changing the shared rule out from under every other phase that uses it.
	const refId = () => {
		if (members.length === 0) {
			throw new Error(
				`manifestEditor.refId: refusing to address an empty manifest (${selfName()}). The ` +
					`address of an empty membership is a constant that every empty manifest in ` +
					`existence would share, which is not an identity.`,
			);
		}
		return contentAddress.manifestKeyForMembership(
			members.map((oneMember) => ({
				blockId: oneMember.schemaBlockRefId,
				position: oneMember.position,
			})),
		);
	};

	// -----
	// schemaBlocks — resolve every member through the standardsDatabase, IN MEMBERSHIP ORDER. An absent block
	// is refused by name rather than skipped: a manifest that quietly resolves two of its three
	// members materializes a partial graph that looks like a whole one.
	const schemaBlocks = (callback) => {
		const resolved = [];

		// a DECLARATION for the same temporal-dead-zone reason as makeManifest: it calls itself
		// from inside the standardsDatabase's callback.
		function resolveNext(index) {
			if (index >= members.length) {
				callback('', resolved);
				return;
			}
			const oneMember = members[index];
			standardsDatabase.getBlock({ refId: oneMember.schemaBlockRefId }, (err, row) => {
				if (err) {
					callback(
						`manifestEditor.schemaBlocks for ${selfName()}: member ` +
							`'${oneMember.subject}': ${err}`,
					);
					return;
				}
				if (!row) {
					callback(
						`manifestEditor.schemaBlocks for ${selfName()}: member ` +
							`'${oneMember.subject}' names schema block ${oneMember.schemaBlockRefId}, which is not in the standardsDatabase ` +
							`at '${standardsDatabase.databaseFilePath}'. Refusing to resolve a partial membership.`,
					);
					return;
				}
				resolved.push(row);
				resolveNext(index + 1);
			});
		}

		resolveNext(0);
	};

	// -----
	// save — persist the membership. The standardsDatabase addresses it BY that membership, so saving the same
	// composition twice dedups onto the manifest already there.
	//
	// An empty manifest is refused here for the same reason refId() refuses it, and through the
	// same door: save() would otherwise write the shared empty-membership constant that refId()
	// will not hand out, and the two verbs would disagree about whether this manifest has an
	// identity at all.
	const save = (callback) => {
		if (members.length === 0) {
			callback(
				`manifestEditor.save: refusing to save an empty manifest (${selfName()}). Its ` +
					`address would be the constant that every empty manifest shares.`,
			);
			return;
		}
		standardsDatabase.saveManifest(
			{ name, description, recipeName, recipeHash, recipeFileName, members },
			(err, saveReport) => {
			if (err) {
				callback(`manifestEditor.save ${selfName()}: ${err}`);
				return;
			}
			callback('', {
				manifestRefId: saveReport.refId,
				memberCount: saveReport.memberCount,
				alreadyPresent: saveReport.alreadyPresent,
			});
			},
		);
	};

	return {
		add,
		members: membersCopy,
		refId,
		schemaBlocks,
		save,
		recipeName: () => recipeName,
		recipeHash: () => recipeHash || '',
		recipeFileName: () => recipeFileName || '',
	};
}

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
