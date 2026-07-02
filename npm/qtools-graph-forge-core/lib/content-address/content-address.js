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

		return { blockIdForText, manifestKeyForMembership, dedupMembersByBlockId, sha256Hex };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
