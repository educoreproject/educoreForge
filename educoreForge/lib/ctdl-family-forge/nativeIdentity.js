'use strict';

// nativeIdentity.js — the ONE rule for "is this IRI the bundle's own?" (FBB-001 / ruling R4), shared by the loader, the walk and
// the round-trip pair so the three can never disagree. Native means EITHER the CURIE's prefix is in the profile's
// nativePrefixList OR the exact IRI is in its nativeTermIdList. The second exists for a namespace a bundle owns only in part:
// CTDL-QData defines ten schema: terms itself and merely references the rest (WORKORDER-P2, "the schema: trap"), so it lists
// those ten and leaves schema: off its prefix list. Both lists are REQUIRED in a profile ([] when unused); none is defaulted.

const prefixOf = (curieText) => `${curieText}`.split(':')[0];

const isNativeIriFor = ({ nativePrefixList, nativeTermIdList }) => {
	if (!Array.isArray(nativePrefixList) || !Array.isArray(nativeTermIdList)) {
		throw new Error('nativeIdentity REFUSED: a vocabulary profile declares both nativePrefixList and nativeTermIdList ([] when unused); there is no default');
	}
	return (iriText) => nativePrefixList.indexOf(prefixOf(iriText)) !== -1 || nativeTermIdList.indexOf(iriText) !== -1;
};

module.exports = { isNativeIriFor, prefixOf };
