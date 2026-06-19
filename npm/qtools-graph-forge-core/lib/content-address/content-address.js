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
		// manifestKeyForMembership — canonical hash over membership.
		//   canonical serialization = members sorted by blockId, each rendered
		//   `blockId + ':' + (position==null ? '' : position)`, joined by '\n', sha256.
		//   Identical membership (same blockIds + positions) => identical key;
		//   ANY change => different key.

		const manifestKeyForMembership = (members = []) => {
			const canonical = members
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

		return { blockIdForText, manifestKeyForMembership, sha256Hex };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
