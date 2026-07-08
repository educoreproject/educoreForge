#!/usr/bin/env node
'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const crypto = require('crypto');

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
		// -----
		// sha256Hex — sha256 of a utf-8 string, lowercase hex

		const sha256Hex = (text) =>
			crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

		// -----
		// blockIdForText — content hash over the exact block bytes (utf-8)

		const blockIdForText = (text) => sha256Hex(text == null ? '' : `${text}`);

		// -----
		// dedupMembersByBlockId — membership is a SET of blocks (M5): the same blockId appearing
		//   twice in a members list (the natural shape when a prior manifest's members are fed
		//   back in and a producer re-appends a block already present) is ONE member. First
		//   occurrence wins, position included; later duplicates are dropped. saveManifest and
		//   manifestKeyForMembership MUST share this exact rule, or the stored membership rows
		//   would not match the key they were addressed under.

		const dedupMembersByBlockId = (members = []) => {
			const seen = new Set();
			return members.filter((oneMember) => {
				if (seen.has(oneMember.blockId)) {
					return false;
				}
				seen.add(oneMember.blockId);
				return true;
			});
		};

		// -----
		// manifestKeyForMembership — canonical hash over membership.
		//   canonical serialization = members deduped by blockId (first occurrence wins), sorted
		//   by blockId, each rendered `blockId + ':' + (position==null ? '' : position)`, joined
		//   by '\n', sha256. Identical EFFECTIVE membership (same blockIds + positions) =>
		//   identical key; ANY change => different key. A duplicated blockId no longer mints a
		//   spuriously distinct key for identical effective membership (M5).

		const manifestKeyForMembership = (members = []) => {
			const canonical = dedupMembersByBlockId(members)
				.map((oneMember) => ({
					blockId: oneMember.blockId,
					position: oneMember.position == null ? null : oneMember.position,
				}))
				.sort((first, second) =>
					first.blockId < second.blockId
						? -1
						: first.blockId > second.blockId
							? 1
							: 0,
				)
				.map(
					(oneMember) =>
						`${oneMember.blockId}:${oneMember.position == null ? '' : oneMember.position}`,
				)
				.join('\n');

			return sha256Hex(canonical);
		};

		// -----
		// vectorIdForInput — content-addressing key for a node embedding VECTOR (embedding
		//   sidecar, PLAN §3.1). A node's vector is a pure function of its determinants
		//   (embeddingModelVersion, embeddingInputText = searchText); this hashes THOSE, so
		//   identical inputs under the same model intern to ONE vectorId (dedup) and the ref is
		//   recomputable from the block alone. The single NUL separator (\u0000) is an unambiguous
		//   boundary: searchText is a printable pipe-delimited string, so a 0x00 byte cannot occur
		//   inside either field. EVERY phase that mints or verifies an embeddingRef (vector-store
		//   put/get, block serialize/deserialize, fingerprint) MUST use THIS function with the
		//   identical separator + field order — the same shared-rule discipline
		//   manifestKeyForMembership enforces. Determinants must be present; a null determinant is
		//   a caller bug, surfaced by the vector store's own required-field guard (not here).

		const NUL = String.fromCharCode(0);

		const vectorIdForInput = (embeddingModelVersion, embeddingInputText) => {
			// PRECONDITION (separator-collision guard): neither determinant may contain a NUL. The
			// NUL is the field SEPARATOR, so a NUL inside a field makes the boundary ambiguous and
			// lets two DISTINCT (modelVersion, inputText) pairs collide to ONE vectorId
			// (e.g. ('a', NUL+'b') and ('a'+NUL, 'b') both serialize to 'a'+NUL+NUL+'b'). searchText
			// is a printable pipe-delimited string, so a NUL is a programming error: fail HARD here
			// (mirrors replay-block.encodeEmbedding throwing on malformed input). The vector-store
			// entry points (putVector/getVector) screen NUL on the CALLBACK channel before calling
			// this, so this throw only fires for a future caller that skipped that guard.
			if (
				`${embeddingModelVersion}`.indexOf(NUL) !== -1 ||
				`${embeddingInputText}`.indexOf(NUL) !== -1
			) {
				throw new Error(
					'content-address.vectorIdForInput: modelVersion/inputText must not contain a NUL ' +
						'byte (NUL is the field separator; a NUL inside a field makes vectorId ambiguous)',
				);
			}
			return sha256Hex(`${embeddingModelVersion}${NUL}${embeddingInputText}`);
		};

		// -----
		// vectorHashForBytes — payload-integrity hash over the RAW vector bytes (the stored
		//   little-endian float32 BLOB). vectorId addresses the INPUT (for dedup); vectorHash
		//   addresses the PAYLOAD, so the vector store's verify-on-read can refuse a corrupted
		//   vector the same way forge-store refuses corrupted block text (blockId==sha256(text)).
		//   Hashes the Buffer bytes DIRECTLY — a utf-8 round-trip (as sha256Hex does for strings)
		//   would corrupt binary, so this is a distinct primitive.

		const vectorHashForBytes = (vectorBytes) =>
			crypto.createHash('sha256').update(vectorBytes).digest('hex');

		return {
			blockIdForText,
			manifestKeyForMembership,
			dedupMembersByBlockId,
			sha256Hex,
			vectorIdForInput,
			vectorHashForBytes,
		};
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
