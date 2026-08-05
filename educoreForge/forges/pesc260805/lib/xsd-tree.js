'use strict';

const moduleName = __filename.replace(__dirname + '/', '').replace(/.js$/, '');

// xsd-tree.js — one XSD file's bytes -> a literal element tree. sax (strict mode) is used INSTEAD
// of the incumbent forge's regex extraction because the SOURCE tier's whole promise is verbatim
// fidelity: a real XML tokenizer preserves text content exactly (no whitespace collapse — R-VAL-2's
// blind spot in the incumbent was a `.replace(/\s+/g,' ')` in exactly this layer), skips comments
// by construction (the incumbent needed a comment-blanking pass after commented-out XSD parsed as
// live), and reports line numbers for refusals that name their site.
//
// The tree is DUMB on purpose: tags, attributes (in document order), children, accumulated text,
// line numbers. No namespace processing, no QName resolution, no schema semantics — those are the
// parser's job, where the refusal rules live. Text is entity-DECODED (standard XML processing;
// `&amp;` in a documentation string means '&') but never trimmed, collapsed, or re-wrapped.
//
// Synchronous: sax's write/close on an in-memory string completes inline, so the callback shape
// would be theater. Returns { root } or { error } — the caller converts to its own error channel.

const sax = require('sax');

// START OF moduleFunction() ============================================================

const moduleFunction =
	({ moduleName } = {}) =>
	(unusedDeps = {}) => {
		// parseXsdTree — ({ xmlText, filename }) -> { root } | { error }
		// root/tree node: { tag, attributes, attributeOrder, children, text, line }
		const parseXsdTree = ({ xmlText, filename }) => {
			const parser = sax.parser(true, { trim: false, normalize: false, xmlns: false });
			const stack = [];
			let root = null;
			let firstError = null;

			parser.onerror = (err) => {
				if (firstError === null) {
					firstError = `${filename}: XML parse error at line ${parser.line + 1}: ${err.message.split('\n')[0]}`;
				}
				// sax can resume after error; we keep the FIRST error and stop trusting the rest.
			};

			parser.onopentag = (openedNode) => {
				const treeNode = {
					tag: openedNode.name,
					attributes: openedNode.attributes,
					attributeOrder: Object.keys(openedNode.attributes),
					children: [],
					text: '',
					line: parser.line + 1,
				};
				if (stack.length === 0) {
					if (root !== null && firstError === null) {
						firstError = `${filename}: more than one root element`;
					}
					root = treeNode;
				} else {
					stack[stack.length - 1].children.push(treeNode);
				}
				stack.push(treeNode);
			};

			parser.onclosetag = () => {
				stack.pop();
			};

			// text arrives in chunks (entity boundaries split it); accumulate verbatim onto the
			// OPEN element. Whitespace between child elements lands here too — harmless, because
			// only leaf text carriers (xs:documentation) ever read .text back.
			const appendText = (textChunk) => {
				if (stack.length > 0) {
					stack[stack.length - 1].text += textChunk;
				}
			};
			parser.ontext = appendText;
			parser.oncdata = appendText;

			parser.write(xmlText).close();

			if (firstError !== null) {
				return { error: firstError };
			}
			if (root === null) {
				return { error: `${filename}: no root element found` };
			}
			return { root };
		};

		return { parseXsdTree };
	};

// END OF moduleFunction() ============================================================

module.exports = moduleFunction({ moduleName });
