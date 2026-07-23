#!/usr/bin/env node
'use strict';

// test-voyage.js — a STANDING gate for the Voyage provider's REQUEST and RESPONSE contract.
//
// NOTHING HERE TOUCHES THE NETWORK. Every assertion runs the real embed() against an INJECTED
// fake transport (the httpsRequest seam), so the built request payload and the returned-vector
// length check are proven without ever opening a socket or spending a cent of Voyage credit.
//
// WHY THIS SUITE EXISTS (money guards, 2026-07-23):
// The configured embeddingDims (voyage.js resolvedConfig.dimension) was NEVER placed on the
// request — output_dimension was absent — and the returned vector lengths were NEVER checked.
// So a config of 512 against a model whose default width is 1024 billed every call AND handed
// back 1024-long vectors that the 512-wide index silently dropped: search quietly empty, money
// quietly spent. This suite keeps output_dimension on every request and refuses any vector whose
// length is not the configured dimension.
//
// Run: node lib/embedding/providers/test/test-voyage.js

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

const helpText = () => `
NAME
     ${moduleName} -- standing gate for the Voyage provider's request/response contract

SYNOPSIS
     ${moduleName} [-verbose] [-quiet] [-help]

DESCRIPTION
     Proves that the configured dimension is SENT as output_dimension on the request payload, and
     that a returned vector whose length is not the configured dimension is REFUSED, naming the
     mismatch. No network: the real embed() runs against an injected fake transport.

EXIT STATUS
     0 all assertions passed;  1 at least one failed.
`;

require('../../../../test/testLib/testAppStartup')({ moduleName, helpText: helpText() });

const harness = require('../../../../test/testLib/harness')(moduleName);

const voyageProvider = require('../voyage');

// -----
// fakeTransport — a stand-in for https.request. It captures the options and the written payload,
//   then drives the caller's response handler with a synthetic response carrying `responseBody`
//   and `statusCode`. No socket is ever opened. Mirrors the node https.request contract voyage.js
//   relies on: request(options, resCallback) -> req with .on('error'), .write(payload), .end().
const fakeTransport = ({ responseBody, statusCode = 200 }) => {
	const captured = {};
	const httpsRequest = (options, resCallback) => {
		captured.options = options;
		const req = {
			on: () => req,
			write: (payload) => {
				captured.payload = payload;
			},
			end: () => {
				const res = {
					statusCode,
					on: (event, handler) => {
						if (event === 'data') {
							handler(Buffer.from(responseBody));
						}
						if (event === 'end') {
							handler();
						}
						return res;
					},
				};
				resCallback(res);
			},
		};
		return req;
	};
	return { httpsRequest, captured };
};

// a Voyage-shaped success body: { data: [ { embedding: [...] }, ... ] }
const voyageBody = (vectors) =>
	JSON.stringify({ data: vectors.map((oneVector) => ({ embedding: oneVector })) });

const RESOLVED_CONFIG = (dimension) => ({
	apiKey: 'NOT-A-REAL-KEY',
	model: 'voyage-4-large',
	dimension,
});

// =====================================================================
harness.section('THE REQUEST — the configured dimension is SENT as output_dimension');
// =====================================================================
// Voyage's /v1/embeddings honours output_dimension (Matryoshka widths) for voyage-4-large; the
// configured embeddingDims arrives here as resolvedConfig.dimension. Omitting it let the model
// answer at its OWN default width, billing the call and returning vectors the index then dropped.

const sentPayload = (() => {
	const { httpsRequest, captured } = fakeTransport({
		responseBody: voyageBody([new Array(512).fill(0.1)]),
	});
	const provider = voyageProvider({ httpsRequest });
	provider.embed(['hello'], RESOLVED_CONFIG(512), () => {});
	return captured.payload ? JSON.parse(captured.payload) : {};
})();

harness.equal(
	'output_dimension is present on the request payload and equals the configured dimension',
	sentPayload.output_dimension,
	512,
);
harness.equal(
	'  the model is still sent — the positive control that the payload is otherwise intact',
	sentPayload.model,
	'voyage-4-large',
);
harness.ok(
	'  and the input texts are still sent',
	Array.isArray(sentPayload.input) && sentPayload.input[0] === 'hello',
	JSON.stringify(sentPayload.input),
);

// =====================================================================
harness.section('THE RESPONSE — a vector whose length is not the configured dimension is REFUSED');
// =====================================================================
// This is the second half of the same silent-loss defect: even with the right width requested, a
// returned vector of the wrong length must be caught rather than handed on to be dropped by the
// index. Operational fault (the provider answered badly) → it travels by CALLBACK, like every
// other response fault in this module.

const embedOutcome = ({ dimension, responseVectors, statusCode = 200 }) => {
	const { httpsRequest } = fakeTransport({
		responseBody: voyageBody(responseVectors),
		statusCode,
	});
	const provider = voyageProvider({ httpsRequest });
	const answered = [];
	provider.embed(['a', 'b'].slice(0, responseVectors.length), RESOLVED_CONFIG(dimension), (err, embeddings) => {
		answered.push({ err, embeddings });
	});
	return {
		errors: answered.filter((one) => one.err).map((one) => one.err),
		embeddings: (answered.find((one) => !one.err) || {}).embeddings,
	};
};

harness.rejects(
	'a SHORT vector (length 3 against a configured 512) is refused, naming the mismatch',
	embedOutcome({ dimension: 512, responseVectors: [new Array(3).fill(0.1)] }).errors,
	/512[\s\S]*3|3[\s\S]*512/,
);
harness.rejects(
	'a LONG vector (length 1024 against a configured 512) is refused too — the exact billing bug',
	embedOutcome({ dimension: 512, responseVectors: [new Array(1024).fill(0.1)] }).errors,
	/512[\s\S]*1024|1024[\s\S]*512/,
);
harness.rejects(
	'  and ANY one bad vector in a batch is caught, naming its index',
	embedOutcome({
		dimension: 4,
		responseVectors: [new Array(4).fill(0.1), new Array(2).fill(0.1)],
	}).errors,
	/index|\[1\]|position/i,
);

// -----
// POSITIVE CONTROL — a batch whose every vector IS the configured width passes clean. Without
// this, "refuse always" would satisfy every rejection above.
const clean = embedOutcome({
	dimension: 4,
	responseVectors: [new Array(4).fill(0.1), new Array(4).fill(0.2)],
});
harness.accepts('a correctly-sized batch is accepted — the positive control', clean.errors);
harness.ok(
	'  and the vectors are handed back intact',
	Array.isArray(clean.embeddings) &&
		clean.embeddings.length === 2 &&
		clean.embeddings[0].length === 4,
	JSON.stringify(clean.embeddings && clean.embeddings.map((one) => one.length)),
);

harness.report();
