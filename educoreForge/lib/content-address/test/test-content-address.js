#!/usr/bin/env node
'use strict';

// test-content-address.js — characterization + contract gates for the content-address primitive
// (M8 coverage gap; Gemini audit §3A; deep-dive review content-address.js:51-71, :97-105).
//
// content-address MINTS EVERY CONTENT ADDRESS IN THE SYSTEM. A block id is sha256(text); a manifest
// address is sha256 of a canonical serialization of its membership; a vector id is sha256 of its
// determinants. A formatting, sort, or separator change here silently REWRITES every id in the
// store and breaks historical replay — so these gates PIN the exact algorithm, not merely "some
// hash". Several assertions are known-answer (a literal hex): they fail if the hashing itself is
// changed, which is the whole point.
//
// The module is PURE and SYNCHRONOUS — no database, no Docker, no Voyage. The suite is the same:
// nothing here opens a file or a socket. That is a hard line, not an accident.
//
// Run: node lib/content-address/test/test-content-address.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- gates for the content-address primitive

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves the load-bearing properties of the id-minting primitive: that manifestKeyForMembership
     is ORDER-INDEPENDENT (identical effective membership in any order mints the IDENTICAL key,
     because the internal sort — not the caller's order — is the address's basis); that a duplicated
     blockId does NOT mint a spuriously distinct key (M5 dedup, first occurrence wins); that a
     genuine change of position or membership DOES change the key; that vectorIdForInput's NUL
     separator guard FIRES rather than letting two distinct inputs collide; and that every function
     is DETERMINISTIC and pins its exact sha256 algorithm by known-answer. Records that
     manifestKeyForMembership carries NO equivalent separator guard.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../test/testLib/harness')(moduleName);

const contentAddress = require('../content-address')();

const {
	blockIdForText,
	manifestKeyForMembership,
	dedupMembersByBlockId,
	sha256Hex,
	vectorIdForInput,
	vectorHashForBytes,
} = contentAddress;

// Known-answer constants. These are the sha256 of literal strings, computed independently of the
// module (standard sha256, lowercase hex). Hardcoding the hex — rather than deriving it from the
// module's own sha256Hex — is deliberate: it catches a change to the HASH itself, not just to the
// serialization around it.
const SHA256_OF_EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const SHA256_OF_CANONICAL_AB = '96ca83e25157cf40159a97eeff5bd26a88e41e584b5c403c7d52f89dcd573f19'; // sha256('a:0\nb:1')

const NUL = String.fromCharCode(0);

// realistic membership: blockIds are sha256-shaped in production, positions are integers
const A = { blockId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', position: 0 };
const B = { blockId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', position: 1 };
const C = { blockId: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', position: 2 };

// =====================================================================
harness.section('SHA256 — the exact algorithm is PINNED (a hash change rewrites every id in the store)');
// =====================================================================

harness.equal('sha256Hex of empty string is the known sha256 constant', sha256Hex(''), SHA256_OF_EMPTY);
harness.match('  and every digest is 64 lowercase hex chars', sha256Hex('anything'), /^[0-9a-f]{64}$/);
harness.equal('sha256Hex is deterministic — same text twice is byte-identical', sha256Hex('x'), sha256Hex('x'));
harness.ok('different text is a different digest', sha256Hex('x') !== sha256Hex('y'));

// =====================================================================
harness.section('blockIdForText — content hash over the exact block bytes, null coerced to empty');
// =====================================================================

harness.equal('blockIdForText is exactly sha256 of the text', blockIdForText('x'), sha256Hex('x'));
harness.equal('null text hashes as the empty string (documented coercion)', blockIdForText(null), SHA256_OF_EMPTY);
harness.equal('undefined text hashes as the empty string too', blockIdForText(undefined), SHA256_OF_EMPTY);
harness.equal('a number is stringified before hashing', blockIdForText(123), sha256Hex('123'));
harness.equal('blockIdForText is deterministic', blockIdForText('block bytes'), blockIdForText('block bytes'));

// =====================================================================
harness.section('manifestKeyForMembership — ORDER-INDEPENDENT (the load-bearing property)');
// =====================================================================
// The address is the hash of the INTERNAL SORT of the membership, not of the order the caller
// happened to supply. Two producers that assemble the identical set of blocks in different orders
// MUST land on the identical manifest — otherwise the same golden gets two addresses and dedup and
// historical replay both break. This is THE property the whole primitive exists to guarantee.
//
// The negative control for this assertion (a deliberately-wrong "order matters" expectation, run
// and watched to FAIL before being corrected to the assertion below) is recorded in the suite's
// report, proving the gate can actually distinguish order-independent from order-sensitive.

const keyABC = manifestKeyForMembership([A, B, C]);
const keyCAB = manifestKeyForMembership([C, A, B]);
const keyBCA = manifestKeyForMembership([B, C, A]);

harness.equal('[A,B,C] and [C,A,B] mint the IDENTICAL key', keyCAB, keyABC);
harness.equal('[A,B,C] and [B,C,A] mint the IDENTICAL key', keyBCA, keyABC);
harness.match('  and it is a well-formed sha256 address', keyABC, /^[0-9a-f]{64}$/);

// KNOWN-ANSWER on the canonical serialization: this pins the EXACT format — sort by blockId, render
// `blockId:position`, join with '\n', sha256 — so ANY change to the separator, the sort, or the
// join is caught here, not discovered when a golden silently re-addresses.
harness.equal(
	'the canonical form is sort + "blockId:position" + join("\\n") + sha256 (exact bytes pinned)',
	manifestKeyForMembership([{ blockId: 'b', position: 1 }, { blockId: 'a', position: 0 }]),
	SHA256_OF_CANONICAL_AB,
);

// =====================================================================
harness.section('manifestKeyForMembership — DEDUP by blockId (M5), first occurrence wins');
// =====================================================================
// The M5 fix: membership is a SET of blocks. The same blockId appearing twice — the natural shape
// when a prior manifest's members are fed back and a producer re-appends a block already present —
// is ONE member, and does NOT mint a spuriously distinct key. First occurrence wins, position
// included; later duplicates are dropped. saveManifest MUST share this rule byte-for-byte.

harness.equal(
	'a duplicated blockId does NOT change the key (dedup, not a distinct member)',
	manifestKeyForMembership([A, A]),
	manifestKeyForMembership([A]),
);
harness.equal(
	'FIRST occurrence wins — a later duplicate with a DIFFERENT position is dropped, not merged',
	manifestKeyForMembership([{ blockId: 'x', position: 0 }, { blockId: 'x', position: 99 }]),
	manifestKeyForMembership([{ blockId: 'x', position: 0 }]),
);

// dedupMembersByBlockId is exported and shared with saveManifest; prove it directly.
const deduped = dedupMembersByBlockId([
	{ blockId: 'x', position: 0 },
	{ blockId: 'x', position: 99 },
	{ blockId: 'y', position: 1 },
]);
harness.equal('dedupMembersByBlockId collapses to the unique blockIds', deduped.length, 2);
harness.equal('  keeping the FIRST occurrence intact (position 0, not 99)', deduped[0].position, 0);
harness.equal('  and preserving the distinct member', deduped[1].blockId, 'y');

// =====================================================================
harness.section('manifestKeyForMembership — a GENUINE change of position or membership DOES change the key');
// =====================================================================
// Order-independence and dedup must not have been bought by making the key insensitive to real
// change. A different position, a different block set, or a different member count is a different
// manifest and MUST mint a different address.

harness.ok(
	'a different position on the same block is a DIFFERENT key',
	manifestKeyForMembership([{ blockId: 'x', position: 0 }]) !==
		manifestKeyForMembership([{ blockId: 'x', position: 1 }]),
);
harness.ok(
	'null position and position 0 are DISTINCT addresses (empty vs "0", not conflated)',
	manifestKeyForMembership([{ blockId: 'x', position: null }]) !==
		manifestKeyForMembership([{ blockId: 'x', position: 0 }]),
);
harness.ok(
	'a different block SET is a different key',
	manifestKeyForMembership([A, B]) !== manifestKeyForMembership([A, C]),
);
harness.ok(
	'adding a member changes the key',
	manifestKeyForMembership([A]) !== manifestKeyForMembership([A, B]),
);
harness.ok(
	'an empty membership addresses, and differently from a populated one',
	manifestKeyForMembership([]) !== manifestKeyForMembership([A]),
);
harness.equal(
	'an empty membership is the hash of the empty canonical string',
	manifestKeyForMembership([]),
	SHA256_OF_EMPTY,
);

// =====================================================================
harness.section('DETERMINISM — the same input twice yields byte-identical output');
// =====================================================================

harness.equal('manifestKeyForMembership is deterministic', manifestKeyForMembership([A, B, C]), manifestKeyForMembership([A, B, C]));
harness.equal('vectorIdForInput is deterministic', vectorIdForInput('model-1', 'input text'), vectorIdForInput('model-1', 'input text'));
harness.equal('vectorHashForBytes is deterministic', vectorHashForBytes(Buffer.from([1, 2, 3])), vectorHashForBytes(Buffer.from([1, 2, 3])));

// =====================================================================
harness.section('vectorIdForInput — addresses the INPUT (dedup) and its NUL separator guard FIRES');
// =====================================================================
// vectorId is sha256(modelVersion + NUL + inputText). Identical determinants intern to ONE id
// (dedup); distinct determinants diverge. The NUL is the field SEPARATOR, and a NUL inside a field
// would make the boundary ambiguous — ('a', NUL+'b') and ('a'+NUL, 'b') would BOTH serialize to
// 'a'+NUL+NUL+'b' and collide. The module GUARDS this with a hard throw. This section proves the
// guard actually fires (a guard never observed refusing is unproven) AND names the input.

harness.equal(
	'identical determinants intern to ONE vectorId (dedup)',
	vectorIdForInput('model-1', 'same text'),
	vectorIdForInput('model-1', 'same text'),
);
harness.ok(
	'a different model version is a different vectorId',
	vectorIdForInput('model-1', 'same text') !== vectorIdForInput('model-2', 'same text'),
);
harness.ok(
	'a different input text is a different vectorId',
	vectorIdForInput('model-1', 'text a') !== vectorIdForInput('model-1', 'text b'),
);
harness.equal(
	'vectorId pins its exact serialization (modelVersion + NUL + inputText, sha256)',
	vectorIdForInput('m', 'i'),
	sha256Hex(`m${NUL}i`),
);

const catchThrow = (fn) => {
	try {
		fn();
	} catch (error) {
		return error;
	}
	return null;
};

harness.match(
	'RED PROOF: a NUL in the input text is REFUSED by name',
	catchThrow(() => vectorIdForInput('model-1', NUL + 'b')),
	/must not contain a NUL/,
);
harness.match(
	'RED PROOF: a NUL in the model version is REFUSED by name',
	catchThrow(() => vectorIdForInput('model' + NUL, 'text')),
	/must not contain a NUL/,
);
// The exact collision pair the module's own comment cites: WITHOUT the guard both serialize to
// 'a' + NUL + NUL + 'b' and mint one id for two distinct inputs. WITH the guard, both throw — the
// collision can never be reached.
harness.ok(
	'  the cited collision pair ("a",NUL+"b") and ("a"+NUL,"b") BOTH throw — the guard closes it',
	!!catchThrow(() => vectorIdForInput('a', NUL + 'b')) &&
		!!catchThrow(() => vectorIdForInput('a' + NUL, 'b')),
);

// =====================================================================
harness.section('vectorHashForBytes — payload hash over RAW bytes, distinct from the utf-8 string path');
// =====================================================================
// vectorId addresses the INPUT; vectorHash addresses the stored PAYLOAD (the little-endian float32
// BLOB) so verify-on-read can refuse a corrupted vector by name. It hashes the Buffer bytes
// DIRECTLY — a utf-8 round-trip (as sha256Hex does for strings) would corrupt binary — so this is a
// separate primitive and the two must not be assumed interchangeable.

harness.equal('vectorHashForBytes of empty bytes is the known sha256 constant', vectorHashForBytes(Buffer.alloc(0)), SHA256_OF_EMPTY);
harness.match('  and every payload hash is 64 lowercase hex chars', vectorHashForBytes(Buffer.from([9, 9, 9])), /^[0-9a-f]{64}$/);
harness.ok(
	'different bytes get a different payload hash',
	vectorHashForBytes(Buffer.from([1, 2, 3])) !== vectorHashForBytes(Buffer.from([1, 2, 4])),
);
// Binary integrity: a byte sequence that is NOT valid utf-8 must hash by its raw bytes, so the raw
// path and the string path are genuinely different primitives on non-utf-8 input.
const loneContinuationByte = Buffer.from([0x80]); // 0x80 alone is invalid utf-8
harness.ok(
	'raw-byte hashing differs from the utf-8 string path on non-utf-8 input (not interchangeable)',
	vectorHashForBytes(loneContinuationByte) !== sha256Hex(loneContinuationByte.toString('utf8')),
);

// =====================================================================
harness.section('FINDING — manifestKeyForMembership has NO separator/injection guard (recorded, not fixed)');
// =====================================================================
// UNLIKE vectorIdForInput, which hard-refuses a NUL in a field, manifestKeyForMembership joins its
// fields with ':' (blockId:position) and its members with '\n' and guards NEITHER separator. A
// blockId or position that CONTAINS those characters can therefore collide across the join boundary:
// the two DISTINCT memberships below mint the IDENTICAL address. This is characterization of ACTUAL
// behavior, asserted so it cannot regress silently — NOT an endorsement.
//
// Why it is not exploitable in practice today (code estimation): production blockIds are sha256 hex
// ([0-9a-f]{64}, no ':' or '\n') and positions are integers, so no real membership can carry a
// separator. The gap is latent, not live. Still worth an explicit guard by symmetry with
// vectorIdForInput's, which is why it is recorded here rather than papered over.
harness.note(
	'manifestKeyForMembership guards no separator: a blockId/position containing ":" or "\\n" can\n' +
		'collide across the join. Latent only because real blockIds are hex and positions integers.',
);

const injectionA = [{ blockId: 'a', position: 1 }, { blockId: 'b', position: 2 }]; // canonical 'a:1\nb:2'
const injectionB = [{ blockId: 'a', position: '1\nb:2' }]; // canonical 'a:1\nb:2' — same bytes
harness.equal(
	'CHARACTERIZATION: two DISTINCT memberships collide via an unguarded separator (documents the gap)',
	manifestKeyForMembership(injectionA),
	manifestKeyForMembership(injectionB),
);

harness.report();
