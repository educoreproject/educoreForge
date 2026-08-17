'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// representationPolicy.js — the pool SEAT policy as DATA (SPEC-bridgeFramework-v1.md §5.6 step 1; BR-068):
// every candidate in a rendered pool carries the REASON it is in the pool (per-seat provenance), and the
// closed list of reasons is declared here. A key-filtered pool names the filter that admitted the card, or a
// plugin nomination; a RETRIEVED pool (matchBasis 'derived') names retrieval (RULING §11.9).
//   filteredOnKey              the card shares the target's canonicalKey and no other tuple field was supplied
//   filteredOnKeyAndTuple      the card shares the canonicalKey AND every supplied tuple field
//   keyPoolOnSourceSideMismatch  the supplied tuple field matched no card; the pool is the KEY's whole pool (BR-062)
//   nominatedBy                a declared nominateCandidates hook nominated it (with rationale)
//   retrieval                  the card was admitted by candidateRetrieval (cosine ≥ floor, within K); the RANK
//                              and the SCORE are forensics and are NEVER rendered (§11.3, §11.4)

const SEAT_REASON_LIST = Object.freeze(['filteredOnKey', 'filteredOnKeyAndTuple', 'keyPoolOnSourceSideMismatch', 'nominatedBy', 'retrieval']);
const REPRESENTATION_POLICY_VERSION = 'bridgeRepresentationPolicy-v1';

const seatReasonRefusal = (seatReason) => (SEAT_REASON_LIST.indexOf(seatReason) === -1 ? `${moduleName}: seat reason '${seatReason}' is not one of ${SEAT_REASON_LIST.join(', ')}` : '');

module.exports = { SEAT_REASON_LIST, REPRESENTATION_POLICY_VERSION, seatReasonRefusal, moduleName };
